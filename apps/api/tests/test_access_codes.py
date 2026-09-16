"""Коды доступа семьи к ребёнку (ADR-0040).

Тесты безопасности не меньше, чем функциональности: код — это доступ к
клиническим данным ребёнка, и от приглашения он отличается тем, что его можно
прочитать вслух. Поэтому проверяется не только «работает», но и «не сгорает зря»
и «не открывает лишнего».

Потребитель ответов — веб-кабинет (`FamilyPanel` в карте и страница `/join`).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from core.config import get_settings
from core.models import AccessCode, AuditLog, ParentPatient
from core.models.enums import UserRole
from core.repositories import access_codes as codes_repo
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

ACTIVATE_URL = "/api/v1/auth/access-codes/activate"
ME_ACTIVATE_URL = "/api/v1/users/me/access-codes/activate"
PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "совершенно новый пароль 42"


def codes_url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/access-codes"


async def _lead(session, doctor, patient) -> None:
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)


class TestIssuing:
    async def test_specialist_issues_code_for_own_patient(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)

        response = await client.post(codes_url(patient.id), headers=auth_headers(doctor))

        assert response.status_code == 201, response.text
        body = response.json()
        # Форма ответа — контракт с кабинетом: он показывает код крупно, рисует
        # по нему QR и подписывает срок.
        assert set(body) == {"code", "expires_at", "deep_link", "join_url"}
        assert len(body["code"]) == 8
        assert body["join_url"].endswith(f"/join?code={body['code']}")

    async def test_code_of_specialist_lives_a_week(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Семь дней, а не пятнадцать минут: код уносят с приёма и активируют дома."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)

        response = await client.post(codes_url(patient.id), headers=auth_headers(doctor))

        expires = datetime.fromisoformat(response.json()["expires_at"])
        assert timedelta(days=6) < expires - datetime.now(UTC) <= timedelta(days=7)

    async def test_dietitian_issues_too(
        self, client, session, make_user, make_patient, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        patient = await make_patient()
        await _lead(session, dietitian, patient)

        response = await client.post(codes_url(patient.id), headers=auth_headers(dietitian))

        assert response.status_code == 201, response.text

    async def test_stranger_specialist_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Чужой ребёнок — 403 проверкой доступа, а не отдельным правилом."""
        stranger = await make_user(UserRole.DOCTOR)
        patient = await make_patient()

        response = await client.post(codes_url(patient.id), headers=auth_headers(stranger))

        assert response.status_code == 403, response.text

    async def test_parent_issues_a_short_lived_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Родитель выпускает код себе — это замена коду привязки чата.

        Срок у него четверть часа, а не неделя: он вводится в соседнем окне, и
        выбор срока живёт в `ttl_for(role)`, а не в ручке (решение 5 ADR-0040).
        """
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        response = await client.post(codes_url(patient.id), headers=auth_headers(parent))

        assert response.status_code == 201, response.text
        expires_at = datetime.fromisoformat(response.json()["expires_at"])
        assert expires_at - datetime.now(UTC) < timedelta(hours=1)

    async def test_issuing_is_written_to_audit(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Кто открыл семье карту ребёнка — вопрос к журналу, а не к памяти."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)

        await client.post(codes_url(patient.id), headers=auth_headers(doctor))

        # Фильтр по ребёнку обязателен: база живёт дольше теста, и запись от
        # соседнего прогона (или от ручной проверки на стенде) выдавала бы себя
        # за проверяемую.
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "access_code_issued",
                AuditLog.entity_id == patient.id,
            )
        )
        assert entry is not None
        assert entry.user_id == doctor.id


class TestJournalAndRevoke:
    async def test_journal_shows_status_and_names(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        await client.post(codes_url(patient.id), headers=auth_headers(doctor))

        listing = await client.get(codes_url(patient.id), headers=auth_headers(doctor))

        assert listing.status_code == 200, listing.text
        row = listing.json()[0]
        assert row["status"] == "pending"
        assert row["issued_by_name"] == doctor.full_name
        assert row["used_by_name"] is None

    async def test_revoked_code_does_not_activate(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        issued = await client.post(codes_url(patient.id), headers=auth_headers(doctor))
        code = issued.json()["code"]

        revoke = await client.post(
            f"{codes_url(patient.id)}/{code}/revoke", headers=auth_headers(doctor)
        )
        assert revoke.status_code == 204, revoke.text

        activation = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )
        assert activation.status_code == 404, activation.text

    async def test_revoking_twice_conflicts(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]
        await client.post(f"{codes_url(patient.id)}/{code}/revoke", headers=auth_headers(doctor))

        again = await client.post(
            f"{codes_url(patient.id)}/{code}/revoke", headers=auth_headers(doctor)
        )

        assert again.status_code == 409, again.text

    async def test_code_of_another_child_is_not_revocable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Отзыв живёт в карте: чужой код через неё не гасится даже по точному попаданию."""
        doctor = await make_user(UserRole.DOCTOR)
        mine = await make_patient()
        other = await make_patient()
        await _lead(session, doctor, mine)
        await _lead(session, doctor, other)
        code = (await client.post(codes_url(other.id), headers=auth_headers(doctor))).json()["code"]

        response = await client.post(
            f"{codes_url(mine.id)}/{code}/revoke", headers=auth_headers(doctor)
        )

        assert response.status_code == 409, response.text
        stored = await codes_repo.get(session, code)
        assert stored is not None and stored.revoked_at is None


class TestActivation:
    async def test_family_gets_account_and_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        response = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама Ани",
                "password": NEW_PASSWORD,
                "phone": "+998901234567",
            },
        )

        assert response.status_code == 201, response.text
        assert response.json()["role"] == "parent"
        link = await session.scalar(
            select(ParentPatient).where(ParentPatient.patient_id == patient.id)
        )
        assert link is not None, "родитель привязан к ребёнку из кода"

    async def test_lowercase_code_works(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Код переписывают с экрана руками: регистр не должен ничего решать."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        response = await client.post(
            ACTIVATE_URL,
            json={
                "code": code.lower(),
                "email": "mama@example.com",
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )

        assert response.status_code == 201, response.text

    @pytest.mark.parametrize(
        "case",
        ["выдуманный", "погашенный", "истёкший"],
    )
    async def test_bad_codes_answer_the_same(
        self, client, session, make_user, make_patient, auth_headers, case
    ):
        """Три негодности — один ответ: иначе подбирающий узнаёт, что код был."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        if case == "выдуманный":
            code = "ZZZZZZZZ"
        elif case == "погашенный":
            await codes_repo.claim(session, code)
        else:
            stored = await codes_repo.get(session, code)
            assert stored is not None
            stored.expires_at = datetime.now(UTC) - timedelta(minutes=1)
            await session.flush()

        response = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )

        assert response.status_code == 404, response.text
        assert response.json()["error"]["message"].startswith("Код недействителен")

    async def test_taken_email_does_not_burn_the_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Человек уже зарегистрирован — это не повод сжечь его единственный код."""
        doctor = await make_user(UserRole.DOCTOR)
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        response = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": parent.email,
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )

        assert response.status_code == 409, response.text
        stored = await codes_repo.get(session, code)
        assert stored is not None and stored.used_at is None, "код вернулся в обращение"

    async def test_issuer_removed_from_patient_refuses_and_keeps_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Выдавшего сняли с пациента — доступ не выдаётся, но код не сгорает.

        Правило ADR-0032, перенесённое на коды: неделя — долгий срок, и за неё
        специалиста могут отключить. Сжигать при этом код семьи нельзя: она не
        участвовала в решении.
        """
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        await patients_repo.unlink_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )

        assert response.status_code == 409, response.text
        stored = await codes_repo.get(session, code)
        assert stored is not None and stored.used_at is None

    async def test_second_activation_of_used_code_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]
        first = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )
        assert first.status_code == 201, first.text

        second = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "papa@example.com",
                "full_name": "Папа",
                "password": NEW_PASSWORD,
            },
        )

        assert second.status_code == 404, "код одноразовый"

    async def test_used_by_lands_in_journal(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]
        await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама Ани",
                "password": NEW_PASSWORD,
            },
        )

        listing = await client.get(codes_url(patient.id), headers=auth_headers(doctor))
        row = next(r for r in listing.json() if r["code"] == code)

        assert row["status"] == "used"
        assert row["used_by_name"] == "Мама Ани", "журнал отвечает, КТО получил доступ"


class TestSecondAdultWithAccount:
    async def test_existing_parent_adds_child_by_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Один экран на два случая: второй ребёнок и второй родитель с учёткой."""
        doctor = await make_user(UserRole.DOCTOR)
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        response = await client.post(
            ME_ACTIVATE_URL, json={"code": code}, headers=auth_headers(parent)
        )

        assert response.status_code == 201, response.text
        assert response.json()["patient_id"] == str(patient.id)
        assert response.json()["patient_name"] == patient.full_name

    async def test_already_linked_keeps_the_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Повторный ввод своего же кода не должен отбирать доступ у второго взрослого."""
        doctor = await make_user(UserRole.DOCTOR)
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        response = await client.post(
            ME_ACTIVATE_URL, json={"code": code}, headers=auth_headers(parent)
        )

        assert response.status_code == 409, response.text
        stored = await codes_repo.get(session, code)
        assert stored is not None and stored.used_at is None

    async def test_specialist_cannot_take_patient_by_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Код семьи — не способ «взять» чужого пациента."""
        doctor = await make_user(UserRole.DOCTOR)
        stranger = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        response = await client.post(
            ME_ACTIVATE_URL, json={"code": code}, headers=auth_headers(stranger)
        )

        assert response.status_code == 403, response.text


class TestFamilyActivatedFlag:
    async def test_new_patient_has_no_family(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Карта без семьи — штатное состояние, и список должен уметь это сказать."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)

        listing = await client.get("/api/v1/patients", headers=auth_headers(doctor))
        row = next(r for r in listing.json()["items"] if r["id"] == str(patient.id))

        assert row["family_activated"] is False

    async def test_flag_turns_true_after_activation(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]
        await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )

        listing = await client.get("/api/v1/patients", headers=auth_headers(doctor))
        row = next(r for r in listing.json()["items"] if r["id"] == str(patient.id))
        overview = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(doctor)
        )

        assert row["family_activated"] is True
        assert overview.json()["family_activated"] is True


class TestAccessBoundaries:
    async def test_unknown_child_is_403_not_404(self, client, make_user, auth_headers):
        """Несуществующий ребёнок отвечает так же, как чужой.

        Иначе выпуск кода становился бы способом узнать, заведена ли карта: 404
        на выдуманный идентификатор и 403 на чужой — это уже ответ.
        """
        doctor = await make_user(UserRole.DOCTOR)

        response = await client.post(codes_url(uuid.uuid4()), headers=auth_headers(doctor))

        assert response.status_code == 403, response.text

    async def test_deactivated_issuer_gives_no_access(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Отключённая учётка не раздаёт доступ уже выданным кодом."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        doctor.is_active = False
        await session.flush()

        response = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )

        assert response.status_code == 409, response.text
        stored = await codes_repo.get(session, code)
        assert stored is not None and stored.used_at is None, "код не сгорел"

    async def test_two_activations_race_gives_one_link(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Два одновременных ввода одного кода — одна привязка.

        Гашение и проверка — один UPDATE (`claim`), поэтому второй запрос видит
        код уже погашенным. Раздельные get + update создали бы две учётные
        записи на один код.
        """
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        first = await codes_repo.claim(session, code)
        second = await codes_repo.claim(session, code)

        assert first is not None and second is None

    async def test_code_survives_only_with_its_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Код указывает на конкретного ребёнка — и живёт ровно в его карте."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        stored = await session.scalar(select(AccessCode).where(AccessCode.code == code))

        assert stored is not None
        assert stored.patient_id == patient.id
        assert stored.issued_by == doctor.id


class TestBotTakesTheSameCode:
    """Потребитель поля `deep_link` — Telegram-бот, и с этапа Б он этот код понимает.

    До этапа Б видов кода было два, и ссылка `t.me/<бот>?start=<код>` на экране
    врача означала бы отказ у КАЖДОЙ семьи на главном экране новой функции.
    Теперь она означает рабочий путь — и это проверяется вызовом ботовой ручки,
    а не чтением кода.
    """

    async def test_issue_offers_both_ways(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)

        issued = await client.post(codes_url(patient.id), headers=auth_headers(doctor))

        assert "/join?code=" in issued.json()["join_url"]
        deep_link = issued.json()["deep_link"]
        assert deep_link is None or issued.json()["code"] in deep_link

    async def test_bot_endpoint_accepts_an_access_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Ручка бота гасит код врача и заводит родителя без почты."""

        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient("Амина")
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        response = await client.post(
            "/api/v1/auth/access-codes/activate-telegram",
            json={
                "code": code,
                "chat_id": 4242,
                "telegram_user_id": 4242,
                "first_name": "Айгуль",
            },
            headers={"X-Bot-Token": get_settings().bot_api_token},
        )

        assert response.status_code == 201, response.text
        assert response.json()["patient_name"] == "Амина"


class TestAdminStaysOut:
    """Администратор к клиническим данным доступа не имеет (правило 5).

    Проверка переехала сюда вместе с механизмом: раньше её роль исполняли тесты
    приглашения второго родителя.
    """

    async def test_admin_cannot_issue(self, client, session, make_user, make_patient, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        patient = await make_patient()

        response = await client.post(codes_url(patient.id), headers=auth_headers(admin))

        assert response.status_code == 403, response.text

    async def test_admin_cannot_read_the_journal(
        self, client, session, make_user, make_patient, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        patient = await make_patient()

        response = await client.get(codes_url(patient.id), headers=auth_headers(admin))

        assert response.status_code == 403, response.text


class TestAuditTrail:
    async def test_revoke_is_audited(self, client, session, make_user, make_patient, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        await client.post(f"{codes_url(patient.id)}/{code}/revoke", headers=auth_headers(doctor))

        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "access_code_revoked",
                AuditLog.entity_id == patient.id,
            )
        )
        assert entry is not None

    async def test_activation_writes_account_and_link(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Две записи, а не одна: появилась учётка И появился доступ к ребёнку."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )

        linked = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "link_parent",
                AuditLog.entity == "parent_patient",
                AuditLog.entity_id == patient.id,
            )
        )
        assert linked is not None
        accepted = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "accept_access_code",
                AuditLog.user_id == linked.user_id,
            )
        )
        assert accepted is not None
        # Сам код в видимой администратору нагрузке не лежит.
        assert "code" not in (accepted.after or {})


class TestCodeSurvivesRefusals:
    """Отказ не должен стоить семье её единственного кода.

    Проверяется исходом, а не механизмом: после отказа код обязан СРАБОТАТЬ. До
    этого тесты смотрели на строку в базе и доказывали не то, что думали —
    возврат кода в бою делает откат транзакции, а в тестовой фикстуре сессия
    подменена и откатов нет (#240).
    """

    async def test_taken_email_leaves_the_code_usable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        occupied = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        refused = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": occupied.email,
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )
        assert refused.status_code == 409, refused.text

        # Тем же кодом, другой почтой — и всё получается.
        accepted = await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": "mama@example.com",
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )

        assert accepted.status_code == 201, accepted.text

    async def test_busy_email_does_not_touch_the_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Занятая почта отклоняется ДО погашения: код даже не трогается."""
        doctor = await make_user(UserRole.DOCTOR)
        occupied = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await _lead(session, doctor, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(doctor))).json()[
            "code"
        ]

        await client.post(
            ACTIVATE_URL,
            json={
                "code": code,
                "email": occupied.email,
                "full_name": "Мама",
                "password": NEW_PASSWORD,
            },
        )

        stored = await codes_repo.get(session, code)
        assert stored is not None
        assert stored.used_at is None and stored.used_by is None


class TestUnlinkingRevokesCodes:
    """Снятие специалиста с пациента гасит его коды (#242).

    Активировать их и так было нельзя — код действует, пока выдавший ведёт
    ребёнка, — но в журнале они оставались «Действует», и новый ведущий врач не
    выдавал свой, видя живой чужой код.
    """

    async def test_codes_of_the_removed_doctor_are_revoked(
        self, client, session, make_user, make_patient, auth_headers
    ):
        first = await make_user(UserRole.DOCTOR)
        second = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, first, patient)
        await _lead(session, second, patient)
        code = (await client.post(codes_url(patient.id), headers=auth_headers(first))).json()[
            "code"
        ]

        removal = await client.delete(
            f"/api/v1/patients/{patient.id}/doctors/{first.id}",
            headers=auth_headers(second),
        )
        assert removal.status_code == 204, removal.text

        journal = await client.get(codes_url(patient.id), headers=auth_headers(second))
        row = next(r for r in journal.json() if r["code"] == code)
        assert row["status"] == "revoked", "журнал обязан говорить правду"

    async def test_codes_of_the_remaining_doctor_survive(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Гасятся коды снятого, а не все подряд."""
        first = await make_user(UserRole.DOCTOR)
        second = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await _lead(session, first, patient)
        await _lead(session, second, patient)
        mine = (await client.post(codes_url(patient.id), headers=auth_headers(second))).json()[
            "code"
        ]

        await client.delete(
            f"/api/v1/patients/{patient.id}/doctors/{first.id}",
            headers=auth_headers(second),
        )

        journal = await client.get(codes_url(patient.id), headers=auth_headers(second))
        row = next(r for r in journal.json() if r["code"] == mine)
        assert row["status"] == "pending"
