"""Пароли, JWT и TOTP (раздел 5.2, 11 ТЗ).

Пароли — argon2id. Access-токен 15 мин, refresh — 30 дней.
Роль и user_id — в claims.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, Literal

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from starlette.concurrency import run_in_threadpool

from core.config import get_settings
from core.models.enums import UserRole

from .errors import ApiError, ErrorCode

ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=30)
# Токен первичной настройки 2FA: выдаётся после проверки пароля пользователю,
# которому 2FA обязательна, но ещё не настроена. Даёт доступ ТОЛЬКО к
# /auth/totp/setup и /auth/totp/verify, поэтому живёт недолго.
TOTP_SETUP_TOKEN_TTL = timedelta(minutes=10)
_ALGORITHM = "HS256"

_hasher = PasswordHasher()

TokenType = Literal["access", "refresh", "totp_setup", "password_reset"]

# Канал, которому выдан токен. `web` в payload не пишется — он же и значение по
# умолчанию для токенов без claim'а `chan`, выпущенных до появления признака.
#
# Важно понимать, чем это оборачивается: `web` — самый ПРИВИЛЕГИРОВАННЫЙ канал, а
# не самый ограниченный. Ему открыты все маршруты, настройка второго фактора и
# выпуск кодов привязки. Значит забытый `channel=` при выпуске токена нового
# канала молча даст ему права веб-сессии. За этим следит компилятор через
# `_SOURCE_BY_CHANNEL` в services/logs.py — словарь обязан покрывать весь
# `Channel`, и добавление значения сюда роняет mypy до того, как новый канал
# доедет до продакшена.
Channel = Literal["web", "bot", "miniapp"]

_TTL_BY_TYPE: dict[str, timedelta] = {
    "access": ACCESS_TOKEN_TTL,
    "refresh": REFRESH_TOKEN_TTL,
    "totp_setup": TOTP_SETUP_TOKEN_TTL,
    # Тот же срок, что у настройки 2FA: это такой же шаг, не завершающий вход, —
    # человек обязан задать свой пароль здесь и сейчас, а не когда вспомнит.
    "password_reset": TOTP_SETUP_TOKEN_TTL,
}


def hash_password(password: str) -> str:
    return _hasher.hash(password)


async def hash_password_async(password: str) -> str:
    """argon2 по умолчанию — 64 МиБ и ~50-100 мс CPU. В event loop это остановило бы
    весь воркер, поэтому в обработчиках запросов используется threadpool."""

    return await run_in_threadpool(hash_password, password)


async def verify_password_async(password_hash: str, password: str) -> bool:
    return await run_in_threadpool(verify_password, password_hash, password)


async def waste_password_verification_async() -> None:
    await run_in_threadpool(waste_password_verification)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    """Хеш заведомо несуществующего пароля: сверка с ним стоит столько же, сколько
    обычная проверка, поэтому «нет такого пользователя» и «неверный пароль» не
    различаются по времени ответа. Считается при первом обращении, а не на импорте
    модуля — иначе полный argon2 (64 МиБ) выполнялся бы при каждом старте процесса."""

    return _hasher.hash("dummy-password-for-constant-time-comparison")


def waste_password_verification() -> None:
    """Выполняет фиктивную проверку argon2, чтобы уравнять время ответа."""

    verify_password(_dummy_hash(), "not-the-password")


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def create_token(
    *,
    user_id: uuid.UUID,
    role: UserRole,
    token_type: TokenType,
    patient_scope: uuid.UUID | None = None,
    password_changed_at: datetime | None = None,
    channel: Channel = "web",
    binding_id: uuid.UUID | None = None,
) -> str:
    """`patient_scope` — ограничение токена одним пациентом (Mini App, раздел 5.2 ТЗ).

    `password_changed_at` попадает в claim `pwd`: токен, выданный до смены
    пароля, отвергается при следующей же проверке. Так требование раздела 11
    «ревокация сессий при смене пароля» выполняется без хранилища выданных
    токенов.

    `channel` попадает в claim `chan` и говорит, откуда токен взялся. Токен
    канала `bot` — не полноценная сессия родителя: он выдаётся автоматике по
    секрету привязки, а не человеку по паролю, поэтому ему закрыты обновление
    сессии, настройка второго фактора и всё, что не нужно сценариям раздела 7
    (ADR-0009). Без этого признака отличить его от сессии человека было бы
    нечем, и утёкший токен бота отмывался бы в постоянную сессию родителя.
    """

    now = datetime.now(UTC)
    ttl = _TTL_BY_TYPE[token_type]
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role.value,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    if patient_scope is not None:
        payload["patient_scope"] = str(patient_scope)
    if password_changed_at is not None:
        payload["pwd"] = int(password_changed_at.timestamp())
    if channel != "web":
        payload["chan"] = channel
    if binding_id is not None:
        # Привязка, по которой выдан токен. Нужна, чтобы отзыв действовал
        # немедленно: без неё отозванная привязка ещё пятнадцать минут
        # писала бы в дневник ребёнка по уже выданному токену.
        payload["tg"] = str(binding_id)

    return jwt.encode(payload, get_settings().secret_key, algorithm=_ALGORITHM)


def auth_challenge(message: str) -> ApiError:
    """401, означающий «предъявленный токен не годится», — с `WWW-Authenticate`.

    Код `unauthorized` API отдаёт и по другим поводам: неверный текущий пароль,
    неверный код подтверждения, неверная пара логин-пароль. Для клиента это
    разные события: первое лечится обновлением токена, остальные — нет.

    Различать их по тексту сообщения нельзя, а `WWW-Authenticate` (RFC 9110,
    §11.6.1) существует ровно для этого: он сопровождает вызов аутентификации и
    не сопровождает отказ по существу запроса. Без него кабинет на «текущий
    пароль указан неверно» молча обновлял сессию, повторял запрос, получал тот
    же отказ и показывал «что-то пошло не так» вместо ответа сервера.
    """

    return ApiError(ErrorCode.UNAUTHORIZED, message, headers={"WWW-Authenticate": "Bearer"})


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    # Заголовок вызова — только для access-токена: отказ по refresh-токену
    # означает «сессия окончена», а не «предъяви токен заново», и обновлять
    # там уже нечего.
    def rejected(message: str) -> ApiError:
        if expected_type == "access":
            return auth_challenge(message)
        return ApiError(ErrorCode.UNAUTHORIZED, message)

    try:
        payload: dict[str, Any] = jwt.decode(
            token, get_settings().secret_key, algorithms=[_ALGORITHM]
        )
    except jwt.ExpiredSignatureError as exc:
        raise rejected("Срок действия сессии истёк, войдите заново.") from exc
    except jwt.PyJWTError as exc:
        raise rejected("Недействительный токен.") from exc

    if payload.get("type") != expected_type:
        raise rejected("Недействительный токен.")

    return payload


def token_predates_password_change(
    payload: dict[str, Any], password_changed_at: datetime | None
) -> bool:
    """True, если токен выдан до последней смены пароля.

    Токены без claim'а `pwd` — выданные до того, как пароль меняли впервые, —
    тоже считаются устаревшими: иначе смена пароля не выгнала бы ровно те
    сессии, ради которых её и делают.
    """

    if password_changed_at is None:
        return False

    issued_for = payload.get("pwd")
    if not isinstance(issued_for, int):
        return True
    return issued_for < int(password_changed_at.timestamp())


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def verify_totp(secret: str, code: str) -> bool:
    """valid_window=1 — допускает соседний 30-секундный интервал (рассинхрон часов)."""

    return pyotp.TOTP(secret).verify(code, valid_window=1)


def totp_provisioning_uri(secret: str, *, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="KetoCare")
