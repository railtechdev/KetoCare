"""Куки аутентификации.

Вынесены из роутера `auth`, потому что их выставляет и смена пароля: она выдаёт
новую пару токенов взамен отозванных. Импортировать приватную функцию чужого
роутера ради этого нельзя — общее место лучше, чем перекрёстная зависимость.
"""

from __future__ import annotations

from fastapi import Response

from .schemas import TokenPair


def set_auth_cookies(response: Response, tokens: TokenPair) -> None:
    """httpOnly cookie для web (раздел 11 ТЗ: httpOnly, secure, samesite=lax)."""

    response.set_cookie(
        "access_token", tokens.access_token, httponly=True, secure=True, samesite="lax"
    )
    response.set_cookie(
        "refresh_token", tokens.refresh_token, httponly=True, secure=True, samesite="lax"
    )
