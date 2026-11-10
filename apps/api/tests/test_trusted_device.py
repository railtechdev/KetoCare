"""Remembered device: the second factor is not asked again for 30 days (ADR-0061).

Reader: the login screen of the web cabinet.
"""

from __future__ import annotations

import pyotp
import pytest

from api.security import hash_password
from core.models.enums import UserRole

pytestmark = pytest.mark.asyncio

PASSWORD = "correct horse battery staple"


def _device_cookie(response) -> str | None:
    for header in response.headers.get_list("set-cookie"):
        if header.startswith("trusted_device="):
            value = header.split(";", 1)[0].split("=", 1)[1]
            return value or None
    return None


async def _login(client, user, *, code=None, remember=False, device=None):
    headers = {"Cookie": f"trusted_device={device}"} if device else {}
    return await client.post(
        "/api/v1/auth/login",
        json={
            "email": user.email,
            "password": PASSWORD,
            "totp_code": code,
            "remember_device": remember,
        },
        headers=headers,
    )


@pytest.fixture
async def doctor(make_user):
    return await make_user(UserRole.DOCTOR, totp_secret=pyotp.random_base32())


async def _remembered(client, doctor) -> str:
    response = await _login(
        client, doctor, code=pyotp.TOTP(doctor.totp_secret).now(), remember=True
    )
    assert response.json()["status"] == "ok", response.text
    token = _device_cookie(response)
    assert token
    return token


async def test_remembered_device_skips_the_code(client, doctor):
    token = await _remembered(client, doctor)

    response = await _login(client, doctor, device=token)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ok"


async def test_device_cookie_is_scoped_and_http_only(client, doctor):
    response = await _login(
        client, doctor, code=pyotp.TOTP(doctor.totp_secret).now(), remember=True
    )

    header = next(
        h for h in response.headers.get_list("set-cookie") if h.startswith("trusted_device=")
    )
    assert "HttpOnly" in header
    assert "Path=/api/v1/auth" in header
    assert "Max-Age=2592000" in header


async def test_without_the_cookie_the_code_is_asked(client, doctor):
    await _remembered(client, doctor)

    response = await _login(client, doctor)

    assert response.json()["status"] == "totp_required"


async def test_password_is_still_required(client, doctor):
    token = await _remembered(client, doctor)

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": doctor.email, "password": "wrong password here"},
        headers={"Cookie": f"trusted_device={token}"},
    )

    assert response.status_code == 401


async def test_new_password_forgets_the_device(client, session, doctor):
    token = await _remembered(client, doctor)
    doctor.password_hash = hash_password(PASSWORD)
    await session.flush()

    response = await _login(client, doctor, device=token)

    assert response.json()["status"] == "totp_required"


async def test_new_second_factor_forgets_the_device(client, session, doctor):
    token = await _remembered(client, doctor)
    doctor.totp_secret = pyotp.random_base32()
    await session.flush()

    response = await _login(client, doctor, device=token)

    assert response.json()["status"] == "totp_required"


async def test_another_users_device_is_not_trusted(client, make_user, doctor):
    token = await _remembered(client, doctor)
    colleague = await make_user(UserRole.DOCTOR, totp_secret=pyotp.random_base32())

    response = await _login(client, colleague, device=token)

    assert response.json()["status"] == "totp_required"


async def test_forget_all_devices(client, auth_headers, doctor):
    token = await _remembered(client, doctor)

    forgot = await client.post("/api/v1/auth/trusted-devices/forget", headers=auth_headers(doctor))
    response = await _login(client, doctor, device=token)

    assert forgot.status_code == 204
    assert response.json()["status"] == "totp_required"


async def test_not_remembered_by_default(client, doctor):
    response = await _login(client, doctor, code=pyotp.TOTP(doctor.totp_secret).now())

    assert response.json()["status"] == "ok"
    assert _device_cookie(response) is None
