"""Привязка Telegram и аутентификация бота (раздел 7.1 ТЗ, ADR-0009).

Большая часть тестов здесь — не про счастливый путь, а про конкретные атаки,
найденные при состязательном разборе проекта: перехват чужого чата, выпуск кода
на чужого ребёнка, отмывание ботового токена в постоянную сессию родителя,
побег из `patient_scope` к другому ребёнку той же семьи.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from core.config import get_settings
from core.models import AuditLog, KetoneLog, LinkCode, TelegramAccount
from core.models.enums import DiarySource, UserRole
from core.repositories import patients as patients_repo

CHAT_ID = 482913001
OTHER_CHAT_ID = 482913002


def bot_headers() -> dict[str, str]:
    """Заголовок сервисного токена бота.

    Пустая настройка означает выключенный канал, и тогда КАЖДЫЙ тест этого файла
    падает на «Канал бота не настроен» — то есть на настройке окружения, а не на
    проверяемом поведении. Именно так они и упали в CI, где переменной не было.
    Отказ здесь называет причину сразу.
    """

    token = get_settings().bot_api_token
    assert token, (
        "BOT_API_TOKEN не задан: канал бота выключен, проверять нечего. "
        "Задайте переменную локально в файле окружения или в env workflow."
    )
    return {"X-Bot-Token": token}


async def _family(session, make_user, make_patient, *, name: str = "Амина"):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient(name)
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


async def _issue_code(client, auth_headers, parent, patient) -> str:
    response = await client.post(
        f"/api/v1/patients/{patient.id}/link-codes", headers=auth_headers(parent)
    )
    assert response.status_code == 201, response.text
    return response.json()["code"]


async def _link(client, auth_headers, parent, patient, chat_id: int = CHAT_ID) -> dict:
    code = await _issue_code(client, auth_headers, parent, patient)
    response = await client.post(
        "/api/v1/auth/link-codes/verify",
        headers=bot_headers(),
        json={"code": code, "chat_id": chat_id},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _bot_session(client, link: dict) -> str:
    response = await client.post(
        "/api/v1/auth/bot/session",
        headers=bot_headers(),
        json={"link_id": link["link_id"], "secret": link["secret"]},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.mark.asyncio
class TestLinkFlow:
    async def test_full_flow_writes_diary_entry(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Сквозной путь: родитель получил код → бот привязался → записал кетоны."""

        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)

        assert link["patient_name"] == "Амина"
        assert link["patient_id"] == str(patient.id)

        token = await _bot_session(client, link)
        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/ketones",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "occurred_at": datetime.now(UTC).isoformat(),
                "value": "3.2",
                "method": "blood",
            },
        )
        assert response.status_code == 201, response.text

    async def test_code_is_single_use(self, client, session, make_user, make_patient, auth_headers):
        parent, patient = await _family(session, make_user, make_patient)
        code = await _issue_code(client, auth_headers, parent, patient)

        first = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": code, "chat_id": CHAT_ID},
        )
        assert first.status_code == 200

        second = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": code, "chat_id": OTHER_CHAT_ID},
        )
        assert second.status_code == 404
        assert second.json()["error"]["code"] == "not_found"

    async def test_expired_code_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _family(session, make_user, make_patient)
        code = await _issue_code(client, auth_headers, parent, patient)

        row = await session.get(LinkCode, code)
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.flush()

        response = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": code, "chat_id": CHAT_ID},
        )
        assert response.status_code == 404

    async def test_unknown_code_answers_like_expired(self, client):
        """Один ответ на «нет такого» и «истёк»: иначе код перебирается."""

        response = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": "ZZZZZZZZ", "chat_id": CHAT_ID},
        )
        assert response.status_code == 404
        assert response.json()["error"]["message"] == "Код привязки недействителен или истёк."


@pytest.mark.asyncio
class TestLinkCodeAccess:
    async def test_parent_cannot_issue_code_for_other_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Ручка живёт под `/patients/{patient_id}`, поэтому `patient_id` нельзя
        подставить в тело мимо проверки доступа."""

        _, victim_patient = await _family(session, make_user, make_patient, name="Чужой ребёнок")
        attacker = await make_user(UserRole.PARENT)

        response = await client.post(
            f"/api/v1/patients/{victim_patient.id}/link-codes", headers=auth_headers(attacker)
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"

    async def test_doctor_cannot_issue_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        patient = await make_patient()
        doctor = await make_user(UserRole.DOCTOR)
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/link-codes", headers=auth_headers(doctor)
        )
        assert response.status_code == 403


@pytest.mark.asyncio
class TestBotServiceToken:
    async def test_missing_token_rejected(self, client):
        response = await client.post(
            "/api/v1/auth/link-codes/verify", json={"code": "AAAAAAAA", "chat_id": CHAT_ID}
        )
        assert response.status_code == 401

    async def test_wrong_token_rejected(self, client):
        response = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers={"X-Bot-Token": "wrong-service-token"},
            json={"code": "AAAAAAAA", "chat_id": CHAT_ID},
        )
        assert response.status_code == 401

    async def test_service_token_alone_gives_no_patient_data(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Главное обещание ADR-0009: сервисный токен сам по себе бесполезен.

        Он не является ни `Authorization`, ни доказательством привязки, поэтому
        ручка с данными пациента отвечает 401 ещё до всякой проверки доступа.
        """

        _, patient = await _family(session, make_user, make_patient)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/menus?date=2026-08-30", headers=bot_headers()
        )
        assert response.status_code == 401

    async def test_wrong_secret_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)

        response = await client.post(
            "/api/v1/auth/bot/session",
            headers=bot_headers(),
            json={"link_id": link["link_id"], "secret": "подобранный секрет"},
        )
        assert response.status_code == 401

    async def test_unknown_link_answers_like_wrong_secret(self, client):
        response = await client.post(
            "/api/v1/auth/bot/session",
            headers=bot_headers(),
            json={"link_id": str(uuid.uuid4()), "secret": "что угодно"},
        )
        assert response.status_code == 401
        assert response.json()["error"]["message"] == "Привязка недействительна."


@pytest.mark.asyncio
class TestChatHijack:
    async def test_live_binding_is_not_retargeted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Чужой живой чат не перенацеливается кодом атакующего.

        `UPDATE ... WHERE chat_id` был бы обновлением по несекретному ключу —
        то есть способом увести чат чужой семьи себе вместе с каналом ввода
        клинических данных.
        """

        victim_parent, victim_patient = await _family(
            session, make_user, make_patient, name="Жертва"
        )
        await _link(client, auth_headers, victim_parent, victim_patient, chat_id=CHAT_ID)

        attacker_parent, attacker_patient = await _family(
            session, make_user, make_patient, name="Ребёнок атакующего"
        )
        code = await _issue_code(client, auth_headers, attacker_parent, attacker_patient)

        response = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": code, "chat_id": CHAT_ID},
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "conflict"

        # Привязка жертвы цела и по-прежнему указывает на её ребёнка.
        rows = list(
            (
                await session.scalars(
                    select(TelegramAccount).where(TelegramAccount.chat_id == CHAT_ID)
                )
            ).all()
        )
        assert len(rows) == 1
        assert rows[0].patient_id == victim_patient.id

    async def test_chat_can_be_relinked_after_revoke(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """После отвязки тот же чат привязывается заново — новой строкой.

        Частичный уникальный индекс `WHERE revoked_at IS NULL` для того и нужен:
        прежняя строка остаётся в журнале.
        """

        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)

        revoke = await client.post(
            f"/api/v1/patients/{patient.id}/telegram/{link['link_id']}/revoke",
            headers=auth_headers(parent),
        )
        assert revoke.status_code == 200
        assert revoke.json()["revoked_at"] is not None

        again = await _link(client, auth_headers, parent, patient)
        assert again["link_id"] != link["link_id"]

        rows = list(
            (
                await session.scalars(
                    select(TelegramAccount).where(TelegramAccount.chat_id == CHAT_ID)
                )
            ).all()
        )
        assert len(rows) == 2, "прежняя привязка обязана остаться в журнале"


@pytest.mark.asyncio
class TestRevoke:
    async def test_revoked_link_cannot_open_session(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)

        await client.post(
            f"/api/v1/patients/{patient.id}/telegram/{link['link_id']}/revoke",
            headers=auth_headers(parent),
        )

        response = await client.post(
            "/api/v1/auth/bot/session",
            headers=bot_headers(),
            json={"link_id": link["link_id"], "secret": link["secret"]},
        )
        assert response.status_code == 401

    async def test_cannot_revoke_link_of_another_patient(
        self, client, session, make_user, make_patient, auth_headers
    ):
        victim_parent, victim_patient = await _family(
            session, make_user, make_patient, name="Жертва"
        )
        victim_link = await _link(client, auth_headers, victim_parent, victim_patient)

        attacker_parent, attacker_patient = await _family(
            session, make_user, make_patient, name="Свой"
        )

        response = await client.post(
            f"/api/v1/patients/{attacker_patient.id}/telegram/{victim_link['link_id']}/revoke",
            headers=auth_headers(attacker_parent),
        )
        assert response.status_code == 404


@pytest.mark.asyncio
class TestBotSessionLimits:
    async def test_scope_blocks_sibling(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Побег к брату или сестре: токен бота сужен до одного ребёнка.

        Родитель имеет доступ к обоим детям, поэтому вторая ступень проверки
        (связь родитель-пациент) атаку не остановит — останавливает `patient_scope`.
        """

        parent, first = await _family(session, make_user, make_patient, name="Первый")
        second = await make_patient("Второй")
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=second.id)

        link = await _link(client, auth_headers, parent, first)
        token = await _bot_session(client, link)

        response = await client.post(
            f"/api/v1/patients/{second.id}/logs/ketones",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "occurred_at": datetime.now(UTC).isoformat(),
                "value": "3.2",
                "method": "blood",
            },
        )
        assert response.status_code == 403

    async def test_route_outside_allow_list_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Раздел 7.5 ТЗ: бот не показывает параметры назначения.

        Роль parent сама по себе открывает назначения, поэтому запрет исполняется
        сервером, а не вежливостью бота.
        """

        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)
        token = await _bot_session(client, link)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/prescriptions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403
        assert response.json()["error"]["message"] == "Это действие недоступно из Telegram-бота."

    async def test_bot_token_cannot_touch_totp(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Отмывание ботового токена в постоянную сессию родителя.

        С доступом к настройке второго фактора временный доступ к чату
        превращался бы во вход в кабинет.
        """

        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)
        token = await _bot_session(client, link)

        response = await client.post(
            "/api/v1/auth/totp/setup", headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 403

    async def test_bot_token_cannot_issue_new_link_codes(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Иначе один захваченный чат размножался бы в новые привязки."""

        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)
        token = await _bot_session(client, link)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/link-codes",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403


@pytest.mark.asyncio
class TestAudit:
    async def test_link_and_unlink_are_audited(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Правило 7: привязка и отвязка Telegram — в журнале обязательно."""

        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)
        await client.post(
            f"/api/v1/patients/{patient.id}/telegram/{link['link_id']}/revoke",
            headers=auth_headers(parent),
        )

        actions = list(
            (
                await session.scalars(select(AuditLog.action).where(AuditLog.user_id == parent.id))
            ).all()
        )
        assert "telegram_link_code_issued" in actions
        assert "telegram_link" in actions
        assert "telegram_unlink" in actions


@pytest.mark.asyncio
class TestValidation:
    async def test_extra_field_rejected(self, client):
        response = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": "AAAAAAAA", "chat_id": CHAT_ID, "parent_id": str(uuid.uuid4())},
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_chat_id_must_be_integer(self, client):
        response = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": "AAAAAAAA", "chat_id": "не число"},
        )
        assert response.status_code == 422


@pytest.mark.asyncio
class TestDiarySource:
    async def test_bot_entry_is_marked_as_bot(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Раздел 4.2 ТЗ различает web и bot.

        Врач в отчёте должен видеть, записан приступ в кабинете за столом или на
        бегу в чате. Пока бота не было, `source` был константой `web`; теперь он
        выводится из канала токена.
        """

        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)
        token = await _bot_session(client, link)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/ketones",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "occurred_at": datetime.now(UTC).isoformat(),
                "value": "3.2",
                "method": "blood",
            },
        )
        assert response.status_code == 201, response.text

        log = await session.scalar(select(KetoneLog).where(KetoneLog.patient_id == patient.id))
        assert log is not None
        assert log.source is DiarySource.BOT

    async def test_web_entry_stays_web(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _family(session, make_user, make_patient)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/ketones",
            headers=auth_headers(parent),
            json={
                "occurred_at": datetime.now(UTC).isoformat(),
                "value": "2.0",
                "method": "urine",
            },
        )
        assert response.status_code == 201, response.text

        log = await session.scalar(select(KetoneLog).where(KetoneLog.patient_id == patient.id))
        assert log is not None
        assert log.source is DiarySource.WEB


@pytest.mark.asyncio
class TestRevokeStopsIssuedSession:
    async def test_issued_token_dies_with_the_binding(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Отвязка обязана действовать немедленно, а не через 15 минут.

        Сценарий «потерял телефон → отвязал в кабинете» бессмыслен, если уже
        выданный токен продолжает писать в дневник ребёнка до истечения срока.
        """

        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)
        token = await _bot_session(client, link)

        # Токен работает, пока привязка жива.
        before = await client.post(
            f"/api/v1/patients/{patient.id}/logs/weight",
            headers={"Authorization": f"Bearer {token}"},
            json={"occurred_at": datetime.now(UTC).isoformat(), "weight_kg": "18.4"},
        )
        assert before.status_code == 201, before.text

        await client.post(
            f"/api/v1/patients/{patient.id}/telegram/{link['link_id']}/revoke",
            headers=auth_headers(parent),
        )

        after = await client.post(
            f"/api/v1/patients/{patient.id}/logs/weight",
            headers={"Authorization": f"Bearer {token}"},
            json={"occurred_at": datetime.now(UTC).isoformat(), "weight_kg": "18.5"},
        )
        assert after.status_code == 401, after.text


@pytest.mark.asyncio
class TestLinksListing:
    async def test_parent_sees_own_links(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/telegram", headers=auth_headers(parent)
        )
        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["id"] == link["link_id"]
        assert body[0]["chat_id"] == CHAT_ID
        assert body[0]["revoked_at"] is None

    async def test_other_parent_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, patient = await _family(session, make_user, make_patient)
        stranger = await make_user(UserRole.PARENT)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/telegram", headers=auth_headers(stranger)
        )
        assert response.status_code == 403

    async def test_admin_has_no_access(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Правило 2: админ к клиническим данным доступа не имеет."""

        _, patient = await _family(session, make_user, make_patient)
        admin = await make_user(UserRole.ADMIN)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/telegram", headers=auth_headers(admin)
        )
        assert response.status_code == 403

    async def test_revoke_forbidden_for_other_parent(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """403 от `require_patient_access` — не путать с 404 от сверки принадлежности."""

        parent, patient = await _family(session, make_user, make_patient)
        link = await _link(client, auth_headers, parent, patient)
        stranger = await make_user(UserRole.PARENT)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/telegram/{link['link_id']}/revoke",
            headers=auth_headers(stranger),
        )
        assert response.status_code == 403


@pytest.mark.asyncio
class TestCodeInput:
    async def test_code_is_case_insensitive(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Код набирают руками с экрана; строчные буквы — не повод для отказа."""

        parent, patient = await _family(session, make_user, make_patient)
        code = await _issue_code(client, auth_headers, parent, patient)

        response = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": code.lower(), "chat_id": CHAT_ID},
        )
        assert response.status_code == 200, response.text

    async def test_busy_chat_does_not_burn_the_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Чужая привязка не должна сжигать код родителя.

        Занятость чата проверяется до погашения, поэтому тот же код проходит,
        как только чат освободили.
        """

        victim_parent, victim_patient = await _family(
            session, make_user, make_patient, name="Жертва"
        )
        victim_link = await _link(client, auth_headers, victim_parent, victim_patient)

        parent, patient = await _family(session, make_user, make_patient, name="Свой")
        code = await _issue_code(client, auth_headers, parent, patient)

        busy = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": code, "chat_id": CHAT_ID},
        )
        assert busy.status_code == 409

        await client.post(
            f"/api/v1/patients/{victim_patient.id}/telegram/{victim_link['link_id']}/revoke",
            headers=auth_headers(victim_parent),
        )

        retry = await client.post(
            "/api/v1/auth/link-codes/verify",
            headers=bot_headers(),
            json={"code": code, "chat_id": CHAT_ID},
        )
        assert retry.status_code == 200, "код не должен был сгореть из-за чужой привязки"


class TestReminderSettings:
    """Раздел 7.4 ТЗ: напоминания настраиваются в кабинете.

    Настроек не было нигде, а задача воркера, которая по ним работает, не
    существовала: обещание «бот напомнит» держалось ни на чём.
    """

    async def test_defaults_before_first_edit(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Строка заводится при первой правке, а не при заведении ребёнка."""

        parent, patient = await _family(session, make_user, make_patient)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/reminders", headers=auth_headers(parent)
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["enabled"] is True
        # Единственное включённое из коробки — мягкое «за сегодня нет записей».
        assert body["no_records_at"] == "20:00:00"
        assert body["ketones_at"] is None

    async def test_saved_settings_are_returned(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _family(session, make_user, make_patient)

        saved = await client.put(
            f"/api/v1/patients/{patient.id}/reminders",
            json={
                "enabled": True,
                "ketones_at": "07:30:00",
                "weight_at": None,
                "medications_at": "21:00:00",
                "no_records_at": "20:00:00",
            },
            headers=auth_headers(parent),
        )
        assert saved.status_code == 200, saved.text

        again = await client.get(
            f"/api/v1/patients/{patient.id}/reminders", headers=auth_headers(parent)
        )
        assert again.json()["ketones_at"] == "07:30:00"
        assert again.json()["weight_at"] is None

    async def test_disabled_is_stored(self, client, session, make_user, make_patient, auth_headers):
        """Выключатель на все разом: семье в больнице не до напоминаний."""

        parent, patient = await _family(session, make_user, make_patient)

        await client.put(
            f"/api/v1/patients/{patient.id}/reminders",
            json={"enabled": False},
            headers=auth_headers(parent),
        )

        response = await client.get(
            f"/api/v1/patients/{patient.id}/reminders", headers=auth_headers(parent)
        )
        assert response.json()["enabled"] is False

    async def test_someone_elses_child_is_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, patient = await _family(session, make_user, make_patient)
        stranger = await make_user(UserRole.PARENT)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/reminders", headers=auth_headers(stranger)
        )
        assert response.status_code == 403

    async def test_someone_elses_child_cannot_be_changed(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Запись проверяется отдельно от чтения: закрытый GET при открытом PUT
        выглядит защищённым и не защищает."""

        _, patient = await _family(session, make_user, make_patient)
        stranger = await make_user(UserRole.PARENT)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/reminders",
            json={"enabled": False},
            headers=auth_headers(stranger),
        )
        assert response.status_code == 403

    @pytest.mark.parametrize(
        "payload",
        [
            {"enabled": True, "ketones_at": "четверть восьмого"},
            {"enabled": True, "ketones_at": "25:00:00"},
            {"enabled": "может быть"},
            # `extra="forbid"`: лишнее поле означает клиента, который считает
            # контракт другим, — принять его молча значит однажды не заметить,
            # что он присылает настройку, которую никто не сохраняет.
            {"enabled": True, "seizures_at": "07:30:00"},
        ],
    )
    async def test_invalid_settings_are_rejected(
        self, client, session, make_user, make_patient, auth_headers, payload
    ):
        parent, patient = await _family(session, make_user, make_patient)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/reminders",
            json=payload,
            headers=auth_headers(parent),
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
