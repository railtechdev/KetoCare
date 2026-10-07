"""Находки security-прохода 07.10.2026 об учётных записях (`docs/SECURITY_REVIEW.md`).

Н1 — правка и удаление записи дневника только автором; Н2 и Н7 — новое
устройство и вход в кабинет из Mini App; Н5 — сообщения о действиях
администратора; Н6 — активация кода в вебе без оракула почты; Н8 — повтор кода
TOTP; Н9 — «Выйти» закрывает сессию; Н14 — журнал правки своего профиля и
языка; Н17 — граница длины предъявляемого пароля.

Потребители ответов, форма которых здесь закреплена: `DiaryList` кабинета и
`DiaryEntries` Mini App (отказ чужой записи — текст сервера в тосте),
`AccountNoticesBanner` кабинета (`GET /users/me/account-notices`),
`WebAccessPanel` Mini App (`reason = new_device`).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from sqlalchemy import select, update

from api.security import create_token, decode_token
from core.config import get_settings
from core.models import AuditLog, KetoneLog, RevokedSession, TelegramAccount
from core.models.enums import DiarySource, UserRole
from core.repositories import access_codes as codes_repo
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo

from .conftest import TEST_PASSWORD
from .test_miniapp_auth import BOT_TOKEN, init_data
from .test_telegram_first_account import bot_headers

pytestmark = pytest.mark.asyncio

CHAT_ID = 771_048_777
ACTIVATE_TELEGRAM = "/api/v1/auth/access-codes/activate-telegram"
ACTIVATE_WEB = "/api/v1/auth/access-codes/activate"
NEW_PASSWORD = "совершенно новый пароль 42"


@pytest.fixture(autouse=True)
def _bot_token(monkeypatch):
    monkeypatch.setenv("BOT_TOKEN", BOT_TOKEN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _audit(session, action: str, entity_id: uuid.UUID) -> AuditLog | None:
    return await session.scalar(
        select(AuditLog).where(AuditLog.action == action, AuditLog.entity_id == entity_id)
    )


# --- Н1: запись дневника правит и удаляет только автор ----------------------


class TestDiaryEntryBelongsToItsAuthor:
    async def _family(self, session, make_user, make_patient):
        mother = await make_user(UserRole.PARENT)
        grandma = await make_user(UserRole.PARENT)
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        for adult in (mother, grandma):
            await patients_repo.link_parent(session, parent_id=adult.id, patient_id=patient.id)
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        log = KetoneLog(
            patient_id=patient.id,
            occurred_at=datetime.now(UTC),
            source=DiarySource.MINIAPP,
            created_by=grandma.id,
            value=1.2,
            method="blood",
        )
        session.add(log)
        await session.flush()
        url = f"/api/v1/patients/{patient.id}/logs/ketones/{log.id}"
        return mother, grandma, doctor, log, url

    async def test_author_corrects_and_removes_with_a_trace(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, grandma, _, log, url = await self._family(session, make_user, make_patient)

        edited = await client.patch(url, json={"value": 2.4}, headers=auth_headers(grandma))
        assert edited.status_code == 200, edited.text
        entry = await _audit(session, "diary_entry_updated", log.id)
        assert entry is not None and entry.user_id == grandma.id
        assert entry.entity == "ketone_logs"
        assert entry.before == {"value": 1.2} and entry.after == {"value": 2.4}

        removed = await client.delete(url, headers=auth_headers(grandma))
        assert removed.status_code == 204, removed.text
        deleted = await _audit(session, "diary_entry_deleted", log.id)
        assert deleted is not None and deleted.user_id == grandma.id

    @pytest.mark.parametrize("who", ["mother", "doctor"])
    async def test_someone_else_cannot_rewrite_or_remove_it(
        self, client, session, make_user, make_patient, auth_headers, who
    ):
        mother, _, doctor, log, url = await self._family(session, make_user, make_patient)
        stranger = mother if who == "mother" else doctor

        edited = await client.patch(url, json={"value": 9.9}, headers=auth_headers(stranger))
        removed = await client.delete(url, headers=auth_headers(stranger))

        for response in (edited, removed):
            assert response.status_code == 403, response.text
            error = response.json()["error"]
            assert error["code"] == "forbidden"
            assert error["message"].startswith("Исправить или удалить запись дневника")
        await session.refresh(log)
        assert float(log.value) == 1.2 and log.deleted_at is None
        assert await _audit(session, "diary_entry_updated", log.id) is None

    async def test_entry_without_an_author_is_nobodys_to_rewrite(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, grandma, _, log, url = await self._family(session, make_user, make_patient)
        log.created_by = None
        await session.flush()

        response = await client.delete(url, headers=auth_headers(grandma))

        assert response.status_code == 403


# --- Н2, Н7: новое устройство и вход в кабинет из Mini App -------------------


async def _born_in_telegram(client, session, make_user, make_patient, auth_headers):
    """Родитель, заведённый ботом по коду врача: его Telegram — CHAT_ID."""

    doctor = await make_user(UserRole.DOCTOR)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    code = await client.post(
        f"/api/v1/patients/{patient.id}/access-codes", headers=auth_headers(doctor)
    )
    assert code.status_code == 201, code.text
    linked = await client.post(
        ACTIVATE_TELEGRAM,
        headers=bot_headers(),
        json={
            "code": code.json()["code"],
            "chat_id": CHAT_ID,
            "telegram_user_id": CHAT_ID,
            "first_name": "Мама",
        },
    )
    assert linked.status_code == 201, linked.text
    links = await telegram_repo.list_active_links_by_chat(session, CHAT_ID)
    return links[0].parent_id, patient


async def _miniapp(client, chat_id: int) -> dict[str, str]:
    opened = await client.post(
        "/api/v1/auth/telegram-init", json={"init_data": init_data(chat_id=chat_id)}
    )
    assert opened.status_code == 200, opened.text
    return _bearer(opened.json()["access_token"])


async def _own_chat_code(client, parent_id, patient) -> str:
    """Код «своего чата» от имени родителя (токен кабинета не нужен — сессия Mini App)."""

    token = create_token(user_id=parent_id, role=UserRole.PARENT, token_type="access")
    response = await client.post(
        f"/api/v1/patients/{patient.id}/access-codes",
        headers=_bearer(token),
        json={"purpose": "own_chat"},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["code"])


class TestNewDevice:
    async def test_own_chat_redemption_warns_the_other_chats(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        parent_id, patient = await _born_in_telegram(
            client, session, make_user, make_patient, auth_headers
        )
        code = await _own_chat_code(client, parent_id, patient)

        second = CHAT_ID + 1
        linked = await client.post(
            ACTIVATE_TELEGRAM,
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": second,
                "telegram_user_id": second,
                "first_name": "Кто-то",
            },
        )

        assert linked.status_code == 201, linked.text
        assert (
            "notify_account_security",
            (str(parent_id), "device_linked", second),
        ) in enqueued

    async def test_second_child_in_a_known_chat_raises_no_alarm(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Тот же чат, тот же человек, ещё один ребёнок — устройство не новое."""

        parent_id, _ = await _born_in_telegram(
            client, session, make_user, make_patient, auth_headers
        )
        second_child = await make_patient("Второй Ребёнок")
        await patients_repo.link_parent(session, parent_id=parent_id, patient_id=second_child.id)
        code = await _own_chat_code(client, parent_id, second_child)

        linked = await client.post(
            ACTIVATE_TELEGRAM,
            headers=bot_headers(),
            json={"code": code, "chat_id": CHAT_ID, "telegram_user_id": CHAT_ID, "first_name": "М"},
        )

        assert linked.status_code == 201, linked.text
        assert not [task for task, _ in enqueued if task == "notify_account_security"]

    async def test_family_member_code_is_not_a_new_device_of_the_account(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Код врача заводит НОВУЮ учётную запись — предупреждать чужую незачем."""

        await _born_in_telegram(client, session, make_user, make_patient, auth_headers)

        assert not [task for task, _ in enqueued if task == "notify_account_security"]

    async def test_new_device_cannot_set_a_web_login_for_a_day(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        parent_id, patient = await _born_in_telegram(
            client, session, make_user, make_patient, auth_headers
        )
        code = await _own_chat_code(client, parent_id, patient)
        second = CHAT_ID + 2
        linked = await client.post(
            ACTIVATE_TELEGRAM,
            headers=bot_headers(),
            json={"code": code, "chat_id": second, "telegram_user_id": second, "first_name": "X"},
        )
        assert linked.status_code == 201, linked.text
        body = {"email": f"thief-{uuid.uuid4().hex[:6]}@example.com", "password": NEW_PASSWORD}

        refused = await client.post(
            "/api/v1/users/me/credentials", headers=await _miniapp(client, second), json=body
        )

        assert refused.status_code == 403, refused.text
        assert refused.json()["error"]["details"] == {"reason": "new_device"}

        # Сутки спустя — можно, и владелец узнаёт об этом во всех чатах.
        await session.execute(
            update(TelegramAccount)
            .where(TelegramAccount.chat_id == second)
            .values(linked_at=datetime.now(UTC) - timedelta(days=2))
        )
        accepted = await client.post(
            "/api/v1/users/me/credentials", headers=await _miniapp(client, second), json=body
        )
        assert accepted.status_code == 201, accepted.text
        assert (
            "notify_account_security",
            (str(parent_id), "web_credentials_set"),
        ) in enqueued

    async def test_the_accounts_own_telegram_sets_it_right_away(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Семья, вышедшая с приёма, включает кабинет в тот же день (ADR-0040)."""

        parent_id, _ = await _born_in_telegram(
            client, session, make_user, make_patient, auth_headers
        )

        response = await client.post(
            "/api/v1/users/me/credentials",
            headers=await _miniapp(client, CHAT_ID),
            json={"email": f"mama-{uuid.uuid4().hex[:6]}@example.com", "password": NEW_PASSWORD},
        )

        assert response.status_code == 201, response.text
        assert ("notify_account_security", (str(parent_id), "web_credentials_set")) in enqueued


# --- Н5: владелец узнаёт о действиях администратора -------------------------


NOTICES = "/api/v1/users/me/account-notices"


class TestAccountNotices:
    async def test_doctor_sees_what_the_admin_did(
        self, client, session, make_user, make_patient, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN, totp_secret=pyotp.random_base32())
        doctor = await make_user(UserRole.DOCTOR, totp_secret=pyotp.random_base32())
        colleague = await make_user(UserRole.DOCTOR)
        for _ in range(2):
            patient = await make_patient()
            await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        reset = await client.post(
            f"/api/v1/admin/users/{doctor.id}/reset-totp", headers=auth_headers(admin)
        )
        assert reset.status_code in (200, 204), reset.text
        moved = await client.post(
            f"/api/v1/admin/users/{doctor.id}/transfer-care",
            headers=auth_headers(admin),
            json={"to_user_id": str(colleague.id)},
        )
        assert moved.status_code == 200, moved.text
        temporary = await client.post(
            f"/api/v1/admin/users/{doctor.id}/reset-password", headers=auth_headers(admin)
        )
        assert temporary.status_code == 200, temporary.text

        # Временный пароль обрывает прежние токены — читаем свежим.
        await session.refresh(doctor)
        fresh = create_token(
            user_id=doctor.id,
            role=doctor.role,
            token_type="access",
            password_changed_at=doctor.password_changed_at,
        )
        notices = await client.get(NOTICES, headers=_bearer(fresh))

        assert notices.status_code == 200, notices.text
        kinds = {item["kind"]: item for item in notices.json()}
        assert set(kinds) == {"password_reset", "totp_reset", "care_handed_over"}
        assert kinds["care_handed_over"]["count"] == 2
        assert set(kinds["password_reset"]) == {"kind", "at", "count"}

        received = await client.get(NOTICES, headers=auth_headers(colleague))
        assert [(item["kind"], item["count"]) for item in received.json()] == [("care_received", 2)]

    async def test_role_change_is_reported_and_own_edits_are_not(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN, totp_secret=pyotp.random_base32())
        dietitian = await make_user(UserRole.DIETITIAN)

        renamed = await client.patch(
            "/api/v1/users/me",
            headers=auth_headers(dietitian),
            json={"full_name": "Новое Имя", "phone": None},
        )
        assert renamed.status_code == 200, renamed.text
        promoted = await client.patch(
            f"/api/v1/admin/users/{dietitian.id}",
            headers=auth_headers(admin),
            json={"role": "doctor"},
        )
        assert promoted.status_code == 200, promoted.text

        notices = await client.get(NOTICES, headers=auth_headers(dietitian))

        assert [item["kind"] for item in notices.json()] == ["role_changed"]

    async def test_old_actions_are_not_repeated_forever(
        self, client, session, make_user, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        session.add(
            AuditLog(
                user_id=None,
                action="totp_reset",
                entity="users",
                entity_id=doctor.id,
                created_at=datetime.now(UTC) - timedelta(days=30),
            )
        )
        await session.flush()

        notices = await client.get(NOTICES, headers=auth_headers(doctor))

        assert notices.json() == []

    async def test_needs_a_session(self, client):
        assert (await client.get(NOTICES)).status_code == 401


# --- Н6: активация в вебе не выдаёт занятость почты --------------------------


class TestJoinIsNotAnEmailOracle:
    async def test_fake_code_answers_the_same_for_any_email(self, client, make_user):
        staff = await make_user(UserRole.DOCTOR)
        answers = []
        for email in (staff.email, f"nobody-{uuid.uuid4().hex[:6]}@example.com"):
            response = await client.post(
                ACTIVATE_WEB,
                json={
                    "code": "ZZZZZZZZ",
                    "email": email,
                    "full_name": "Мама",
                    "password": NEW_PASSWORD,
                },
            )
            answers.append((response.status_code, response.json()))

        assert answers[0] == answers[1]
        assert answers[0][0] == 404

    async def test_live_code_with_a_taken_email_keeps_the_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        code = (
            await client.post(
                f"/api/v1/patients/{patient.id}/access-codes", headers=auth_headers(doctor)
            )
        ).json()["code"]

        response = await client.post(
            ACTIVATE_WEB,
            json={"code": code, "email": parent.email, "full_name": "М", "password": NEW_PASSWORD},
        )

        assert response.status_code == 409, response.text
        stored = await codes_repo.get(session, code)
        assert stored is not None and stored.used_at is None


# --- Н8: код TOTP одноразовый ------------------------------------------------


class TestTotpReplay:
    async def test_the_same_code_does_not_open_a_second_session(self, client, make_user):
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)
        body = {
            "email": doctor.email,
            "password": TEST_PASSWORD,
            "totp_code": pyotp.TOTP(secret).now(),
        }

        first = await client.post("/api/v1/auth/login", json=body)
        replay = await client.post("/api/v1/auth/login", json=body)

        assert first.status_code == 200, first.text
        assert first.json()["status"] == "ok"
        assert replay.status_code == 401, replay.text
        assert replay.json()["error"]["message"] == "Неверный код подтверждения."

    async def test_previous_window_after_the_current_one_is_a_replay(
        self, client, session, make_user
    ):
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)
        totp = pyotp.TOTP(secret)
        now = datetime.now(UTC)
        doctor.totp_last_step = totp.timecode(now)
        await session.flush()

        previous = await client.post(
            "/api/v1/auth/login",
            json={
                "email": doctor.email,
                "password": TEST_PASSWORD,
                "totp_code": totp.at(now - timedelta(seconds=30)),
            },
        )

        assert previous.status_code == 401


# --- Н9: «Выйти» закрывает сессию -------------------------------------------


class TestLogoutRevokes:
    async def test_cabinet_refresh_dies_with_logout_and_other_sessions_live(
        self, client, make_user
    ):
        parent = await make_user(UserRole.PARENT)
        credentials = {"email": parent.email, "password": TEST_PASSWORD}
        first = await client.post("/api/v1/auth/login", json=credentials)
        second = await client.post("/api/v1/auth/login", json=credentials)
        stolen = first.json()["tokens"]["refresh_token"] or first.cookies.get("refresh_token")
        other = second.json()["tokens"]["refresh_token"] or second.cookies.get("refresh_token")
        assert stolen and other

        # Обновление переносит сессию: и прежний, и новый токен — одна сессия.
        refreshed = await client.post("/api/v1/auth/refresh", json={"refresh_token": stolen})
        assert refreshed.status_code == 200, refreshed.text
        renewed = refreshed.json()["refresh_token"] or refreshed.cookies.get("refresh_token")
        assert (
            decode_token(renewed, expected_type="refresh")["sid"]
            == decode_token(stolen, expected_type="refresh")["sid"]
        )

        client.cookies.clear()
        out = await client.post("/api/v1/auth/logout", json={"refresh_token": renewed})
        assert out.status_code == 204

        for token in (stolen, renewed):
            dead = await client.post("/api/v1/auth/refresh", json={"refresh_token": token})
            assert dead.status_code == 401, dead.text
        alive = await client.post("/api/v1/auth/refresh", json={"refresh_token": other})
        assert alive.status_code == 200, alive.text

    async def test_logout_reads_the_cookie(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        login = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": TEST_PASSWORD}
        )
        cookie = login.cookies.get("refresh_token")
        assert cookie

        # Cookie `secure`, а транспорт теста — http: передаём заголовком.
        out = await client.post(
            "/api/v1/auth/logout", headers={"Cookie": f"refresh_token={cookie}"}
        )

        assert out.status_code == 204
        sid = decode_token(cookie, expected_type="refresh")["sid"]
        assert await session.get(RevokedSession, sid) is not None

    async def test_miniapp_refresh_honours_logout(self, client, session, make_user, make_patient):
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        await telegram_repo.create_link(
            session,
            parent_id=parent.id,
            patient_id=patient.id,
            chat_id=CHAT_ID,
            secret=telegram_repo.generate_binding_secret(),
        )
        opened = await client.post(
            "/api/v1/auth/telegram-init", json={"init_data": init_data(chat_id=CHAT_ID)}
        )
        refresh = opened.json()["refresh_token"]

        await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
        dead = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})

        assert dead.status_code == 401

    async def test_logout_without_a_session_is_quiet(self, client):
        assert (await client.post("/api/v1/auth/logout")).status_code == 204
        garbage = await client.post("/api/v1/auth/logout", json={"refresh_token": "nonsense"})
        assert garbage.status_code == 204


# --- Н14: правка своего профиля и языка — в журнале --------------------------


class TestOwnAccountEditsAreAudited:
    async def test_profile_and_language(self, client, session, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        profile = await client.patch(
            "/api/v1/users/me",
            headers=auth_headers(parent),
            json={"full_name": "Мама Ани", "phone": "+998901112233"},
        )
        language = await client.put(
            "/api/v1/users/me/language", headers=auth_headers(parent), json={"language": "uz"}
        )

        assert profile.status_code == 200 and language.status_code == 200
        edited = await _audit(session, "profile_updated", parent.id)
        assert edited is not None and edited.after == {
            "full_name": "Мама Ани",
            "phone": "+998901112233",
        }
        switched = await _audit(session, "language_changed", parent.id)
        assert switched is not None and switched.after == {"language": "uz"}

    async def test_unchanged_language_writes_nothing(
        self, client, session, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        for _ in range(2):
            await client.put(
                "/api/v1/users/me/language", headers=auth_headers(parent), json={"language": "ru"}
            )

        rows = list(
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.action == "language_changed", AuditLog.entity_id == parent.id
                )
            )
        )
        assert len(rows) == 1


# --- Н17: длина предъявляемого пароля ---------------------------------------


async def test_login_refuses_a_megabyte_password(client, make_user):
    parent = await make_user(UserRole.PARENT)

    response = await client.post(
        "/api/v1/auth/login", json={"email": parent.email, "password": "x" * 257}
    )

    assert response.status_code == 422
