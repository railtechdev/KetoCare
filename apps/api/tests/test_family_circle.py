"""«Близкие» ребёнка: кто кого позвал, кто вправе убрать, что гаснет вместе с доступом.

ADR-0043. Ориентиры — MyChart, Apple Health, Family Link: тот, кто открыл
доступ, видит его и закрывает сам, а о новом близком узнаёт вся семья.

Потребители: кабинет (`FamilyPanel`) и Mini App (блок «Близкие» на главной).
`details.reason` у отказов активации читает бот (`start._conflict_text`).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from core.config import get_settings
from core.models import AccessCode, AuditLog, ParentPatient
from core.models.enums import UserRole
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo

pytestmark = pytest.mark.asyncio

FAMILY = {"purpose": "family_member"}
TELEGRAM_URL = "/api/v1/auth/access-codes/activate-telegram"


def codes_url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/access-codes"


def parents_url(patient_id, parent_id=None) -> str:
    base = f"/api/v1/patients/{patient_id}/parents"
    return base if parent_id is None else f"{base}/{parent_id}"


def bot_headers() -> dict[str, str]:
    token = get_settings().bot_api_token
    assert token, "BOT_API_TOKEN не задан: канал бота выключен, проверять нечего."
    return {"X-Bot-Token": token}


async def _family(session, make_user, make_patient, client, auth_headers):
    """Врач позвал маму; мама позвала бабушку кодом; папа пришёл по коду врача."""

    doctor = await make_user(UserRole.DOCTOR)
    patient = await make_patient("Амина")
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

    mother = await make_user(UserRole.PARENT)
    await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)

    async def join(issuer, adult):
        code = (
            await client.post(codes_url(patient.id), headers=auth_headers(issuer), json=FAMILY)
        ).json()["code"]
        response = await client.post(
            "/api/v1/users/me/access-codes/activate",
            headers=auth_headers(adult),
            json={"code": code},
        )
        assert response.status_code == 201, response.text

    grandma = await make_user(UserRole.PARENT)
    await join(mother, grandma)
    father = await make_user(UserRole.PARENT)
    await join(doctor, father)
    return doctor, patient, mother, grandma, father


def _by_id(rows):
    return {row["id"]: row for row in rows}


class TestWhoSeesWhat:
    async def test_inviter_is_named(self, client, session, make_user, make_patient, auth_headers):
        doctor, patient, mother, grandma, father = await _family(
            session, make_user, make_patient, client, auth_headers
        )

        rows = _by_id(
            (await client.get(parents_url(patient.id), headers=auth_headers(mother))).json()
        )

        assert rows[str(grandma.id)]["invited_by_name"] == mother.full_name
        assert rows[str(father.id)]["invited_by_name"] == doctor.full_name
        assert rows[str(mother.id)]["is_me"] is True

    async def test_who_may_remove_whom(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Кто позвал — тот убирает; сам — уходит; врач — кого угодно.

        Бабушка не может убрать маму: прав «хозяина семьи» в системе нет, и
        иначе приглашённый вытеснял бы того, кто его позвал.
        """
        doctor, patient, mother, grandma, father = await _family(
            session, make_user, make_patient, client, auth_headers
        )

        async def removable(viewer):
            rows = (await client.get(parents_url(patient.id), headers=auth_headers(viewer))).json()
            return {row["id"] for row in rows if row["can_remove"]}

        assert await removable(mother) == {str(mother.id), str(grandma.id)}
        assert await removable(grandma) == {str(grandma.id)}
        # Папу подключил врач — он основной родитель и убирает тех, кого
        # позвала семья (бабушку), но не маму: основные друг друга не убирают.
        assert await removable(father) == {str(father.id), str(grandma.id)}
        assert await removable(doctor) == {str(mother.id), str(grandma.id), str(father.id)}


class TestLeadParent:
    async def test_lead_removes_a_stranger_invited_by_grandma(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Мама получает «подключился новый близкий: …, по приглашению бабушки».

        Без права основного родителя она не могла бы закрыть доступ незнакомцу —
        уведомление звало бы к действию, которого у неё нет.
        """
        _, patient, mother, grandma, _ = await _family(
            session, make_user, make_patient, client, auth_headers
        )
        code = (
            await client.post(codes_url(patient.id), headers=auth_headers(grandma), json=FAMILY)
        ).json()["code"]
        nanny = await make_user(UserRole.PARENT)
        joined = await client.post(
            "/api/v1/users/me/access-codes/activate",
            headers=auth_headers(nanny),
            json={"code": code},
        )
        assert joined.status_code == 201, joined.text

        response = await client.delete(
            parents_url(patient.id, nanny.id), headers=auth_headers(mother)
        )

        assert response.status_code == 204, response.text
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "unlink_parent", AuditLog.entity_id == patient.id
            )
        )
        assert entry is not None and entry.after["ground"] == "lead"

    async def test_invited_adult_is_not_a_lead(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Бабушка, позванная мамой, не убирает папу, подключённого врачом."""
        _, patient, _, grandma, father = await _family(
            session, make_user, make_patient, client, auth_headers
        )

        response = await client.delete(
            parents_url(patient.id, father.id), headers=auth_headers(grandma)
        )

        assert response.status_code == 403


class TestRemoval:
    async def test_inviter_closes_access_and_everything_goes_with_it(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Связь, чаты и неиспользованные коды бабушки гаснут одним действием.

        Чат — потому что бот опирается на привязку, а не на связь с ребёнком:
        без отзыва бабушка продолжала бы писать в дневник. Коды — потому что
        иначе она успела бы позвать кого-то ещё уже после того, как её убрали.
        """
        _, patient, mother, grandma, _ = await _family(
            session, make_user, make_patient, client, auth_headers
        )
        chat = await telegram_repo.create_link(
            session,
            parent_id=grandma.id,
            patient_id=patient.id,
            chat_id=771_600_001,
            secret=telegram_repo.generate_binding_secret(),
        )
        her_code = (
            await client.post(codes_url(patient.id), headers=auth_headers(grandma), json=FAMILY)
        ).json()["code"]

        response = await client.delete(
            parents_url(patient.id, grandma.id), headers=auth_headers(mother)
        )

        assert response.status_code == 204, response.text
        link = await session.scalar(
            select(ParentPatient).where(
                ParentPatient.parent_id == grandma.id, ParentPatient.patient_id == patient.id
            )
        )
        assert link is None
        await session.refresh(chat)
        assert chat.revoked_at is not None
        code = await session.get(AccessCode, her_code)
        await session.refresh(code)
        assert code.revoked_at is not None

        # И доступ действительно закрыт, а не только строка исчезла.
        overview = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(grandma)
        )
        assert overview.status_code == 403

        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "unlink_parent", AuditLog.entity_id == patient.id
            )
        )
        assert entry is not None
        assert entry.user_id == mother.id
        assert entry.before == {"parent_id": str(grandma.id)}
        assert entry.after["ground"] == "inviter"
        assert entry.after["revoked_chats"] == 1

    async def test_invited_cannot_remove_the_inviter(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, patient, mother, grandma, _ = await _family(
            session, make_user, make_patient, client, auth_headers
        )

        response = await client.delete(
            parents_url(patient.id, mother.id), headers=auth_headers(grandma)
        )

        assert response.status_code == 403, response.text
        assert "пригласил" in response.json()["error"]["message"]

    async def test_anyone_may_leave(self, client, session, make_user, make_patient, auth_headers):
        _, patient, _, _, father = await _family(
            session, make_user, make_patient, client, auth_headers
        )

        response = await client.delete(
            parents_url(patient.id, father.id), headers=auth_headers(father)
        )

        assert response.status_code == 204, response.text

    async def test_specialist_removes_anyone(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient, mother, _, _ = await _family(
            session, make_user, make_patient, client, auth_headers
        )

        response = await client.delete(
            parents_url(patient.id, mother.id), headers=auth_headers(doctor)
        )

        assert response.status_code == 204, response.text

    async def test_stranger_is_refused_by_access_check(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, patient, mother, _, _ = await _family(
            session, make_user, make_patient, client, auth_headers
        )
        stranger = await make_user(UserRole.PARENT)

        response = await client.delete(
            parents_url(patient.id, mother.id), headers=auth_headers(stranger)
        )

        assert response.status_code == 403

    async def test_someone_not_in_the_family(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient, _, _, _ = await _family(
            session, make_user, make_patient, client, auth_headers
        )
        outsider = await make_user(UserRole.PARENT)

        response = await client.delete(
            parents_url(patient.id, outsider.id), headers=auth_headers(doctor)
        )

        assert response.status_code == 404


class TestFamilyIsTold:
    async def test_new_adult_is_announced(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Доступ к данным ребёнка не появляется тихо (ADR-0043)."""

        _, patient, mother, grandma, _ = await _family(
            session, make_user, make_patient, client, auth_headers
        )

        joined = [(task, *args) for task, args in enqueued if task == "notify_family_joined"]
        names = {item[3] for item in joined}
        assert grandma.full_name in names
        grandma_notice = next(item for item in joined if item[3] == grandma.full_name)
        assert grandma_notice[1:3] == (str(patient.id), str(grandma.id))
        assert grandma_notice[4] == mother.full_name

    async def test_own_chat_code_is_not_announced(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Свой второй телефон — не новый близкий."""
        mother = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(mother))).json()[
            "code"
        ]

        response = await client.post(
            TELEGRAM_URL,
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": 771_600_100,
                "telegram_user_id": 771_600_100,
                "first_name": "Мама",
            },
        )

        assert response.status_code == 201, response.text
        assert [task for task, _ in enqueued if task == "notify_family_joined"] == []


class TestForgivingInput:
    @pytest.mark.parametrize(
        "typed",
        [
            "{a}{b}",  # как выдан
            "{a} {b}",  # группами, как диктуют
            "{a}-{b}",
            " {a_lower}{b_lower} ",
        ],
    )
    async def test_code_typed_by_hand_is_accepted(
        self, typed, client, session, make_user, make_patient, auth_headers
    ):
        mother = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)
        code = (
            await client.post(codes_url(patient.id), headers=auth_headers(mother), json=FAMILY)
        ).json()["code"]
        a, b = code[:4], code[4:]
        other = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/users/me/access-codes/activate",
            headers=auth_headers(other),
            json={"code": typed.format(a=a, b=b, a_lower=a.lower(), b_lower=b.lower())},
        )

        assert response.status_code == 201, response.text

    async def test_cyrillic_lookalikes_are_accepted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Переписывая код на русской раскладке, человек набирает «А», а не «A»."""
        mother = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)
        code = (
            await client.post(codes_url(patient.id), headers=auth_headers(mother), json=FAMILY)
        ).json()["code"]
        # Код выдаётся случайным; подставляем такой, у которого все буквы имеют
        # кириллических двойников, — иначе проверять было бы нечего.
        await session.execute(
            AccessCode.__table__.update().where(AccessCode.code == code).values(code="ABEKMHPC")
        )
        session.expunge_all()
        other = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/users/me/access-codes/activate",
            headers=auth_headers(other),
            json={"code": "АВЕКМНРС"},
        )

        assert response.status_code == 201, response.text


class TestBotRefusalsSayWhy:
    async def test_chat_already_with_this_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        mother = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)
        await telegram_repo.create_link(
            session,
            parent_id=mother.id,
            patient_id=patient.id,
            chat_id=771_600_200,
            secret=telegram_repo.generate_binding_secret(),
        )
        code = (
            await client.post(codes_url(patient.id), headers=auth_headers(mother), json=FAMILY)
        ).json()["code"]

        response = await client.post(
            TELEGRAM_URL,
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": 771_600_200,
                "telegram_user_id": 771_600_200,
                "first_name": "Мама",
            },
        )

        assert response.status_code == 409
        assert response.json()["error"]["details"] == {"reason": "already_here"}
        # Код не сгорел: он предназначался кому-то другому.
        stored = await session.get(AccessCode, code)
        assert stored is not None and stored.used_at is None

    async def test_chat_with_another_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        mother = await make_user(UserRole.PARENT)
        first = await make_patient("Первый")
        second = await make_patient("Второй")
        for child in (first, second):
            await patients_repo.link_parent(session, parent_id=mother.id, patient_id=child.id)
        await telegram_repo.create_link(
            session,
            parent_id=mother.id,
            patient_id=first.id,
            chat_id=771_600_300,
            secret=telegram_repo.generate_binding_secret(),
        )
        code = (
            await client.post(codes_url(second.id), headers=auth_headers(mother), json=FAMILY)
        ).json()["code"]

        response = await client.post(
            TELEGRAM_URL,
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": 771_600_300,
                "telegram_user_id": 771_600_300,
                "first_name": "Мама",
            },
        )

        assert response.status_code == 409
        assert response.json()["error"]["details"] == {"reason": "chat_taken"}


class TestChatOwnersAreNamed:
    async def test_link_list_names_the_owner(
        self, client, session, make_user, make_patient, auth_headers
    ):
        mother = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)
        await telegram_repo.create_link(
            session,
            parent_id=mother.id,
            patient_id=patient.id,
            chat_id=771_600_400,
            secret=telegram_repo.generate_binding_secret(),
        )

        rows = (
            await client.get(
                f"/api/v1/patients/{patient.id}/telegram", headers=auth_headers(mother)
            )
        ).json()

        assert [row["parent_name"] for row in rows] == [mother.full_name]


class TestInviterIsWhoCreatedTheLink:
    """Находки ревью ADR-0043: «пригласивший» — автор кода, СОЗДАВШЕГО связь."""

    async def test_code_used_by_someone_already_in_does_not_make_an_inviter(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Мама ввела в боте код бабушки (второй телефон) — бабушка не её «пригласившая».

        Пока пригласивший выводился из истории кодов, бабушка после этого видела
        у мамы «Закрыть доступ» и могла ею воспользоваться.
        """
        doctor, patient, mother, grandma, _ = await _family(
            session, make_user, make_patient, client, auth_headers
        )
        mother.telegram_user_id = 771_600_500
        await session.flush()
        code = (
            await client.post(codes_url(patient.id), headers=auth_headers(grandma), json=FAMILY)
        ).json()["code"]

        activated = await client.post(
            TELEGRAM_URL,
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": 771_600_501,
                "telegram_user_id": 771_600_500,
                "first_name": "Мама",
            },
        )
        assert activated.status_code == 201, activated.text

        rows = _by_id(
            (await client.get(parents_url(patient.id), headers=auth_headers(grandma))).json()
        )
        assert rows[str(mother.id)]["can_remove"] is False
        assert rows[str(mother.id)]["invited_by_name"] is None
        refused = await client.delete(
            parents_url(patient.id, mother.id), headers=auth_headers(grandma)
        )
        assert refused.status_code == 403

    async def test_readded_by_the_doctor_belongs_to_the_doctor(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Бабушку убрал врач и вернул своим кодом — мама больше не её «пригласившая»."""
        doctor, patient, mother, grandma, _ = await _family(
            session, make_user, make_patient, client, auth_headers
        )
        removed = await client.delete(
            parents_url(patient.id, grandma.id), headers=auth_headers(doctor)
        )
        assert removed.status_code == 204
        code = (
            await client.post(codes_url(patient.id), headers=auth_headers(doctor), json=FAMILY)
        ).json()["code"]
        back = await client.post(
            "/api/v1/users/me/access-codes/activate",
            headers=auth_headers(grandma),
            json={"code": code},
        )
        assert back.status_code == 201, back.text

        rows = _by_id(
            (await client.get(parents_url(patient.id), headers=auth_headers(mother))).json()
        )
        assert rows[str(grandma.id)]["invited_by_name"] == doctor.full_name
        assert rows[str(grandma.id)]["can_remove"] is False


class TestChannels:
    async def test_bot_cannot_remove(self, session, make_user, make_patient):
        """Бот — автоматика с сервисным токеном: закрывать доступ ему незачем."""
        from api.deps.auth import CurrentUser
        from api.errors import ApiError
        from api.services import family as family_service

        doctor = await make_user(UserRole.DOCTOR)
        mother = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)

        with pytest.raises(ApiError) as refused:
            await family_service.remove(
                session,
                patient_id=patient.id,
                member_id=mother.id,
                actor=CurrentUser(id=doctor.id, role=UserRole.DOCTOR, channel="bot"),
                ip=None,
            )
        assert refused.value.status_code == 403

    async def test_malformed_id_is_a_validation_error(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.delete(
            f"{parents_url(patient.id)}/not-a-uuid", headers=auth_headers(doctor)
        )

        assert response.status_code == 422


class TestNoticeOnlyAfterCommit:
    async def test_refused_activation_announces_nothing(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Отказ после постановки — ни одной вести о «новом близком».

        Отказ здесь — «этот ребёнок уже есть в вашем кабинете», он случается
        после погашения; уведомление отложено до коммита и при откате
        выбрасывается.
        """
        mother = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)
        code = (
            await client.post(codes_url(patient.id), headers=auth_headers(mother), json=FAMILY)
        ).json()["code"]

        response = await client.post(
            "/api/v1/users/me/access-codes/activate",
            headers=auth_headers(mother),
            json={"code": code},
        )

        assert response.status_code == 409
        assert [task for task, _ in enqueued if task == "notify_family_joined"] == []

    async def test_deferred_tasks_are_dropped_on_discard(self):
        from types import SimpleNamespace

        from api import after_commit

        fake = SimpleNamespace(info={})
        after_commit.defer(fake, "notify_family_joined", "p", "n", "Мария", None)  # type: ignore[arg-type]
        after_commit.discard(fake)  # type: ignore[arg-type]

        assert fake.info == {}
