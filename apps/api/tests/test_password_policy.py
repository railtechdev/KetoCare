"""Очевидные пароли не принимаются (аудит блокеров, E7; NIST SP 800-63B).

Потребитель — все формы задания пароля: принятие приглашения, вход по коду в
веб, «Вход в кабинет» в Mini App, смена и сброс пароля. Причина отказа приходит
верхним сообщением ответа — его и показывают клиенты.
"""

from __future__ import annotations

import pytest

from api.password_policy import MESSAGE, is_obvious

OBVIOUS = [
    "111111111111",
    "qwerty123456",
    "password1234",
    "йцукенгшщзхъ",
    "123456789012",
    "abcabcabcabc",
    "Пароль123456",
    "1q2w3e4r5t6y",
    "ketocare2026!",
]
FINE = [
    "синий чайник на подоконнике",
    "correct horse battery staple",
    "мама-любит-рыбу-2026",
    "Tashkent_kids_keto_9",
]


@pytest.mark.parametrize("password", OBVIOUS)
def test_obvious_is_refused(password: str) -> None:
    assert is_obvious(password)


@pytest.mark.parametrize("password", FINE)
def test_a_phrase_passes(password: str) -> None:
    """Список без правил состава: фраза из слов проходит, как и советует экран."""
    assert not is_obvious(password)


@pytest.mark.asyncio
async def test_the_reason_reaches_the_person(client, make_user, auth_headers) -> None:
    from core.models.enums import UserRole

    from .conftest import TEST_PASSWORD

    parent = await make_user(UserRole.PARENT)
    response = await client.post(
        "/api/v1/users/me/password",
        headers=auth_headers(parent),
        json={"current_password": TEST_PASSWORD, "new_password": "qwerty123456"},
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["message"] == MESSAGE
