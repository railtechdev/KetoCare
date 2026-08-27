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

TokenType = Literal["access", "refresh", "totp_setup"]

_TTL_BY_TYPE: dict[str, timedelta] = {
    "access": ACCESS_TOKEN_TTL,
    "refresh": REFRESH_TOKEN_TTL,
    "totp_setup": TOTP_SETUP_TOKEN_TTL,
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
) -> str:
    """`patient_scope` — ограничение токена одним пациентом (Mini App, раздел 5.2 ТЗ)."""

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

    return jwt.encode(payload, get_settings().secret_key, algorithm=_ALGORITHM)


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(
            token, get_settings().secret_key, algorithms=[_ALGORITHM]
        )
    except jwt.ExpiredSignatureError as exc:
        raise ApiError(
            ErrorCode.UNAUTHORIZED, "Срок действия сессии истёк, войдите заново."
        ) from exc
    except jwt.PyJWTError as exc:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Недействительный токен.") from exc

    if payload.get("type") != expected_type:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Недействительный токен.")

    return payload


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def verify_totp(secret: str, code: str) -> bool:
    """valid_window=1 — допускает соседний 30-секундный интервал (рассинхрон часов)."""

    return pyotp.TOTP(secret).verify(code, valid_window=1)


def totp_provisioning_uri(secret: str, *, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="KetoCare")
