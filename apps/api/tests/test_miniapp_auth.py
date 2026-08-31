"""Вход в Mini App по подписи Telegram (раздел 5.2, 9, 13 ТЗ).

Строка `initData` приходит от клиента, и без проверки подписи она значит ровно
столько же, сколько любой заголовок запроса. Поэтому проверка алгоритма — здесь
же, рядом с проверкой ручки: подделанная строка не должна открывать кабинет
чужого ребёнка.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import pytest
from sqlalchemy import select

from api.security import decode_token
from api.services.telegram_initdata import MAX_AGE, InitDataError, parse_init_data
from core.config import get_settings
from core.models import AuditLog
from core.models.enums import UserRole
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo

BOT_TOKEN = "1234567:AA-test-token"
CHAT_ID = 987654321


@pytest.fixture(autouse=True)
def bot_token(monkeypatch):
    """Токен бота задаётся тестом, а не окружением.

    Подпись считается ключом из токена: взяв его из `.env`, прогон зависел бы
    от того, настроен ли бот на этой машине, — и в CI, где токена нет, проверял
    бы «канал не настроен» вместо алгоритма.
    """

    monkeypatch.setenv("BOT_TOKEN", BOT_TOKEN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def sign(fields: dict[str, str], *, token: str = BOT_TOKEN) -> str:
    check = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    return hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()


def init_data(*, chat_id: int = CHAT_ID, at: datetime | None = None, token: str = BOT_TOKEN) -> str:
    moment = at or datetime.now(UTC)
    fields = {
        "user": json.dumps({"id": chat_id, "first_name": "Мама"}, ensure_ascii=False),
        "auth_date": str(int(moment.timestamp())),
        "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
    }
    return urlencode({**fields, "hash": sign(fields, token=token)})


class TestSignature:
    """Алгоритм проверки — без HTTP и без базы."""

    def test_accepts_a_genuine_string(self) -> None:
        parsed = parse_init_data(init_data(), bot_token=BOT_TOKEN)
        assert parsed.user_id == CHAT_ID

    def test_rejects_a_forged_signature(self) -> None:
        fields = dict(
            user=json.dumps({"id": CHAT_ID}),
            auth_date=str(int(datetime.now(UTC).timestamp())),
        )
        forged = urlencode({**fields, "hash": "0" * 64})
        with pytest.raises(InitDataError):
            parse_init_data(forged, bot_token=BOT_TOKEN)

    def test_rejects_a_string_signed_by_another_bot(self) -> None:
        """Подпись чужого бота — это чужая система, а не наша сессия."""

        with pytest.raises(InitDataError):
            parse_init_data(init_data(token="7654321:BB-other"), bot_token=BOT_TOKEN)

    def test_rejects_tampered_user_id(self) -> None:
        """Главная атака: подменить id пользователя, оставив подпись.

        Ровно так открывался бы кабинет чужого ребёнка.
        """

        raw = init_data()
        tampered = raw.replace(str(CHAT_ID), "111111111")
        with pytest.raises(InitDataError):
            parse_init_data(tampered, bot_token=BOT_TOKEN)

    def test_rejects_an_expired_string(self) -> None:
        old = datetime.now(UTC) - MAX_AGE - timedelta(minutes=1)
        with pytest.raises(InitDataError):
            parse_init_data(init_data(at=old), bot_token=BOT_TOKEN)

    def test_accepts_a_string_within_its_hour(self) -> None:
        recent = datetime.now(UTC) - MAX_AGE + timedelta(minutes=1)
        assert parse_init_data(init_data(at=recent), bot_token=BOT_TOKEN).user_id == CHAT_ID

    def test_rejects_a_repeated_key(self) -> None:
        """Повторяющийся ключ отвергается, даже если подпись сходится.

        Строка собрана так, что словарь «последнее значение побеждает» даёт
        ровно те пары, для которых считалась подпись. Без явного отказа такая
        строка прошла бы — а по документации Telegram в проверочную строку
        входят ВСЕ пары, и значит подпись относится не к тем данным, которые мы
        приняли бы.
        """

        moment = datetime.now(UTC)
        fields = {
            "user": json.dumps({"id": CHAT_ID}),
            "auth_date": str(int(moment.timestamp())),
            "query_id": "ПОСЛЕДНИЙ",
        }
        raw = urlencode({**fields, "hash": sign(fields)})
        doubled = f"query_id=ПЕРВЫЙ&{raw}"

        with pytest.raises(InitDataError):
            parse_init_data(doubled, bot_token=BOT_TOKEN)

    def test_rejects_a_string_without_signature(self) -> None:
        with pytest.raises(InitDataError):
            parse_init_data("user=%7B%22id%22%3A1%7D&auth_date=1", bot_token=BOT_TOKEN)

    def test_rejects_everything_when_the_bot_is_not_configured(self) -> None:
        """Пустой токен даёт предсказуемый ключ — подпись подберёт кто угодно."""

        with pytest.raises(InitDataError):
            parse_init_data(init_data(), bot_token="")


async def _linked_family(session, make_user, make_patient, *, chat_id: int = CHAT_ID):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    link = await telegram_repo.create_link(
        session,
        parent_id=parent.id,
        patient_id=patient.id,
        chat_id=chat_id,
        secret=telegram_repo.generate_binding_secret(),
    )
    return parent, patient, link


class TestTelegramInit:
    pytestmark = pytest.mark.asyncio

    async def test_signed_launch_opens_a_scoped_session(
        self, client, session, make_user, make_patient, monkeypatch
    ):
        parent, patient, link = await _linked_family(session, make_user, make_patient)

        response = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["patient_id"] == str(patient.id)
        assert body["patient_name"] == patient.full_name

        claims = decode_token(body["access_token"], expected_type="access")
        assert claims["sub"] == str(parent.id)
        assert claims["role"] == UserRole.PARENT.value
        # Сужение до ребёнка и канал — то, ради чего этот вход отличается от
        # входа паролем: сессия открыта привязкой чата, а не паролем родителя.
        assert claims["patient_scope"] == str(patient.id)
        assert claims["chan"] == "miniapp"
        assert claims["tg"] == str(link.id)

    async def test_forged_launch_is_rejected(self, client, session, make_user, make_patient):
        await _linked_family(session, make_user, make_patient)

        response = await client.post(
            "/api/v1/auth/telegram-init",
            json={
                "init_data": urlencode(
                    {
                        # Всё, кроме подписи, безупречно: и время свежее, и
                        # пользователь тот самый. Иначе тест проходил бы и с
                        # выключенной проверкой подписи — на отсутствии
                        # `auth_date`.
                        "user": json.dumps({"id": CHAT_ID}),
                        "auth_date": str(int(datetime.now(UTC).timestamp())),
                        "hash": "0" * 64,
                    }
                )
            },
        )

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    async def test_unlinked_telegram_gets_the_binding_instruction(
        self, client, session, make_user, make_patient
    ):
        """Не «нет прав», а «привяжите чат»: приложению нужно показать путь."""

        await _linked_family(session, make_user, make_patient, chat_id=555)

        response = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})

        assert response.status_code == 404
        assert "привяз" in response.json()["error"]["message"].lower()

    async def test_revoked_binding_no_longer_opens_the_app(
        self, client, session, make_user, make_patient
    ):
        _, _, link = await _linked_family(session, make_user, make_patient)
        await telegram_repo.revoke(session, link.id)

        response = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})

        assert response.status_code == 404

    async def test_login_is_written_to_the_audit_log(
        self, client, session, make_user, make_patient
    ):
        parent, _, link = await _linked_family(session, make_user, make_patient)

        await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})

        # Запрос сужен до привязки, созданной этим тестом. База у прогона общая
        # с ручной работой: «любая запись с action=login_miniapp» находила
        # чужую, и тест падал не на своей ошибке (та же ловушка описана в
        # `test_leads.py`).
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "login_miniapp", AuditLog.entity_id == link.id
            )
        )
        assert entry is not None
        assert entry.user_id == parent.id
        assert entry.entity == "telegram_accounts"


class TestScopeSurvivesRefresh:
    pytestmark = pytest.mark.asyncio

    async def test_refresh_keeps_the_channel_and_the_scope(
        self, client, session, make_user, make_patient
    ):
        """Иначе сужённый токен разменивался бы на полную сессию родителя."""

        _, patient, link = await _linked_family(session, make_user, make_patient)
        opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})

        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": opened.json()["refresh_token"]},
        )

        assert response.status_code == 200
        claims = decode_token(response.json()["access_token"], expected_type="access")
        assert claims["chan"] == "miniapp"
        assert claims["patient_scope"] == str(patient.id)
        assert claims["tg"] == str(link.id)

    async def test_revoked_binding_kills_the_open_session(
        self, client, session, make_user, make_patient
    ):
        """Отвязка действует сейчас, а не через пятнадцать минут."""

        _, patient, link = await _linked_family(session, make_user, make_patient)
        opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})
        token = opened.json()["access_token"]

        await telegram_repo.revoke(session, link.id)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401

    async def test_open_session_reaches_the_child_it_was_scoped_to(
        self, client, session, make_user, make_patient
    ):
        _, patient, _ = await _linked_family(session, make_user, make_patient)
        opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview",
            headers={"Authorization": f"Bearer {opened.json()['access_token']}"},
        )
        assert response.status_code == 200

    async def test_open_session_cannot_reach_another_child(
        self, client, session, make_user, make_patient
    ):
        parent, _, _ = await _linked_family(session, make_user, make_patient)
        stranger = await make_patient()
        opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})

        response = await client.get(
            f"/api/v1/patients/{stranger.id}/overview",
            headers={"Authorization": f"Bearer {opened.json()['access_token']}"},
        )
        assert response.status_code in (403, 404)


class TestRefreshDefends:
    """Обновление токенов не должно быть слабее самой выдачи."""

    pytestmark = pytest.mark.asyncio

    async def test_revoked_binding_cannot_be_refreshed(
        self, client, session, make_user, make_patient
    ):
        """Иначе отозванный чат тридцать дней менял бы refresh на новый refresh.

        К данным его бы не пустили, но сессия не кончалась бы никогда.
        """

        _, _, link = await _linked_family(session, make_user, make_patient)
        opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})
        await telegram_repo.revoke(session, link.id)

        response = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": opened.json()["refresh_token"]}
        )

        assert response.status_code == 401

    async def test_role_change_ends_the_session(self, client, session, make_user, make_patient):
        """Смена роли родителя на сотрудника не должна превращать сессию Mini App
        в токен врача — с правом писать назначения."""

        parent, _, _ = await _linked_family(session, make_user, make_patient)
        opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})

        parent.role = UserRole.DOCTOR
        await session.flush()

        response = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": opened.json()["refresh_token"]}
        )

        assert response.status_code == 401


class TestRequestValidation:
    """Валидация тела: раздел 5.1 ТЗ — 422 и `validation_error`."""

    pytestmark = pytest.mark.asyncio

    async def test_empty_init_data_is_rejected(self, client):
        response = await client.post("/api/v1/auth/telegram-init", json={"init_data": ""})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_unknown_field_is_rejected(self, client):
        # `extra="forbid"`: лишнее поле означает клиента, который считает
        # контракт другим, — и молча принять его значит однажды не заметить,
        # что он передаёт patient_id и ждёт, что его учтут.
        response = await client.post(
            "/api/v1/auth/telegram-init",
            json={"init_data": init_data(), "patient_id": "любой"},
        )

        assert response.status_code == 422
