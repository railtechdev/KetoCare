"""Родитель открывает доступ к ребёнку другому взрослому (ADR-0042).

Решение заказчика от 02.10.2026: выдавать доступ вправе не только врач. Код с
назначением `family_member` от родителя ведёт себя так же, как код
специалиста: неделя жизни, действует в боте и в вебе, заводит НОВУЮ учётную
запись незнакомому человеку. Код своего чата (`own_chat`) остаётся прежним —
это проверяет `test_telegram_first_account.py`.

Потребитель — веб-кабинет: раздел «Ребёнок» → «Кто ведёт» (`AccessCodePanel`).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from core.config import get_settings
from core.models import AccessCode, AuditLog, ParentPatient
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

ACTIVATE_URL = "/api/v1/auth/access-codes/activate"
ME_ACTIVATE_URL = "/api/v1/users/me/access-codes/activate"
TELEGRAM_URL = "/api/v1/auth/access-codes/activate-telegram"
FAMILY = {"purpose": "family_member"}


def codes_url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/access-codes"


def bot_headers() -> dict[str, str]:
    token = get_settings().bot_api_token
    assert token, "BOT_API_TOKEN не задан: канал бота выключен, проверять нечего."
    return {"X-Bot-Token": token}


async def _family(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient("Амина")
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


async def _issue(client, auth_headers, parent, patient) -> str:
    response = await client.post(codes_url(patient.id), headers=auth_headers(parent), json=FAMILY)
    assert response.status_code == 201, response.text
    return response.json()["code"]


async def _parents_of(session, patient) -> set:
    rows = await session.scalars(
        select(ParentPatient.parent_id).where(ParentPatient.patient_id == patient.id)
    )
    return set(rows.all())


class TestIssuing:
    async def test_parent_issues_a_week_long_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Неделя, как у врача: код уносят ко второму взрослому, а не вводят тут же."""
        parent, patient = await _family(session, make_user, make_patient)

        response = await client.post(
            codes_url(patient.id), headers=auth_headers(parent), json=FAMILY
        )

        assert response.status_code == 201, response.text
        body = response.json()
        # Форма ответа та же, что у кода специалиста: экран выдачи один.
        assert set(body) == {"code", "expires_at", "deep_link", "join_url"}
        expires = datetime.fromisoformat(body["expires_at"])
        assert timedelta(days=6) < expires - datetime.now(UTC) <= timedelta(days=7)

    async def test_parent_of_another_child_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Родитель раздаёт доступ только к своему ребёнку — 403 проверкой доступа."""
        _, patient = await _family(session, make_user, make_patient)
        neighbour = await make_user(UserRole.PARENT)

        response = await client.post(
            codes_url(patient.id), headers=auth_headers(neighbour), json=FAMILY
        )

        assert response.status_code == 403, response.text

    async def test_specialist_cannot_issue_an_own_chat_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Код своего чата привязал бы Telegram к сотруднику — такого кода у него нет."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.post(
            codes_url(patient.id), headers=auth_headers(doctor), json={"purpose": "own_chat"}
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"

    async def test_unknown_purpose_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _family(session, make_user, make_patient)

        for body in ({"purpose": "everyone"}, {"purpose": "family_member", "ttl": 99}):
            response = await client.post(
                codes_url(patient.id), headers=auth_headers(parent), json=body
            )
            assert response.status_code == 422, (body, response.text)

    async def test_issuing_writes_purpose_to_audit(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """В журнале «подключил свой чат» и «открыл доступ другому» — разные события."""
        parent, patient = await _family(session, make_user, make_patient)

        code = await _issue(client, auth_headers, parent, patient)

        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "access_code_issued",
                AuditLog.entity_id == patient.id,
                AuditLog.user_id == parent.id,
            )
        )
        assert entry is not None
        assert entry.after == {
            "code": code,
            "purpose": "family_member",
            "expires_at": entry.after["expires_at"],
        }

    async def test_journal_names_purpose(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _family(session, make_user, make_patient)
        family_code = await _issue(client, auth_headers, parent, patient)
        own_code = (await client.post(codes_url(patient.id), headers=auth_headers(parent))).json()[
            "code"
        ]

        journal = await client.get(codes_url(patient.id), headers=auth_headers(parent))

        assert journal.status_code == 200, journal.text
        purposes = {row["code"]: row["purpose"] for row in journal.json()}
        assert purposes == {family_code: "family_member", own_code: "own_chat"}


class TestActivation:
    async def test_new_adult_joins_on_the_web(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Тот же `/join`, что у кода врача: второй взрослый заводит свою учётную запись."""
        parent, patient = await _family(session, make_user, make_patient)
        code = await _issue(client, auth_headers, parent, patient)

        response = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "grandma@example.com",
                "full_name": "Бабушка Амины",
                "password": "очень-длинный-пароль",
            },
        )

        assert response.status_code == 201, response.text
        parents = await _parents_of(session, patient)
        assert parent.id in parents and len(parents) == 2

        stored = await session.get(AccessCode, code)
        assert stored is not None and stored.used_by not in (None, parent.id)

    async def test_existing_account_adds_the_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Второй взрослый уже родитель другого ребёнка — добавляет этого кодом."""
        parent, patient = await _family(session, make_user, make_patient)
        other = await make_user(UserRole.PARENT)
        code = await _issue(client, auth_headers, parent, patient)

        response = await client.post(
            ME_ACTIVATE_URL, headers=auth_headers(other), json={"code": code}
        )

        assert response.status_code == 201, response.text
        assert other.id in await _parents_of(session, patient)

    async def test_new_telegram_gets_its_own_account(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Главное отличие от кода своего чата: чат уходит НОВОЙ учётной записи.

        Код своего чата привязывает чат к выдавшему. Код для другого взрослого
        так делать не должен: иначе записи второго взрослого в дневнике
        подписывались бы именем первого, и отключить его отдельно было бы
        нельзя.
        """
        parent, patient = await _family(session, make_user, make_patient)
        code = await _issue(client, auth_headers, parent, patient)
        telegram_id = 771_500_111

        response = await client.post(
            TELEGRAM_URL,
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": telegram_id,
                "telegram_user_id": telegram_id,
                "first_name": "Бабушка",
            },
        )

        assert response.status_code == 201, response.text
        parents = await _parents_of(session, patient)
        assert len(parents) == 2

        stored = await session.get(AccessCode, code)
        assert stored is not None and stored.used_by not in (None, parent.id)
        await session.refresh(parent)
        assert parent.telegram_user_id is None, "чужой Telegram не стал удостоверением"

    async def test_code_dies_with_issuers_account(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Учётную запись выдавшего отключили — его неделя кода тоже кончилась.

        То же правило, что у специалиста (ADR-0032): иначе отключённый родитель
        продолжал бы раздавать доступ к ребёнку уже выданными кодами. И код при
        этом не сгорает — по той же причине, что у кода врача.
        """
        parent, patient = await _family(session, make_user, make_patient)
        code = await _issue(client, auth_headers, parent, patient)
        parent.is_active = False
        await session.flush()

        response = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "late@example.com",
                "full_name": "Опоздавший",
                "password": "очень-длинный-пароль",
            },
        )

        assert response.status_code == 409, response.text
        stored = await session.get(AccessCode, code)
        assert stored is not None and stored.used_at is None


class TestJournal:
    async def test_second_adult_does_not_see_the_first_parents_own_chat_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Находка ревью: чужой живой код своего чата в журнале — это подмена.

        Второй взрослый, прочитав его, ввёл бы его в боте из своего Telegram —
        и чат привязался бы к учётной записи первого родителя: записи в
        дневнике шли бы от её имени. Врач тоже кода не видит: тот же вред.
        """
        mother, patient = await _family(session, make_user, make_patient)
        own = (await client.post(codes_url(patient.id), headers=auth_headers(mother))).json()[
            "code"
        ]
        grandma = await make_user(UserRole.PARENT)
        await patients_repo.link_parent(session, parent_id=grandma.id, patient_id=patient.id)
        doctor = await make_user(UserRole.DOCTOR)
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        for viewer in (grandma, doctor):
            rows = (await client.get(codes_url(patient.id), headers=auth_headers(viewer))).json()
            assert [row["code"] for row in rows] == [None], viewer.role
            assert rows[0]["purpose"] == "own_chat"
            assert rows[0]["status"] == "pending"

        rows = (await client.get(codes_url(patient.id), headers=auth_headers(mother))).json()
        assert [row["code"] for row in rows] == [own]

    async def test_family_code_stays_visible_to_everyone_at_the_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Код для другого взрослого виден всем: его отзывают из журнала."""
        mother, patient = await _family(session, make_user, make_patient)
        code = await _issue(client, auth_headers, mother, patient)
        doctor = await make_user(UserRole.DOCTOR)
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        rows = (await client.get(codes_url(patient.id), headers=auth_headers(doctor))).json()

        assert [row["code"] for row in rows] == [code]
