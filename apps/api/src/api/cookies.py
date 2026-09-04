"""Куки аутентификации.

Вынесены из роутера `auth`, потому что их выставляет и смена пароля: она выдаёт
новую пару токенов взамен отозванных. Импортировать приватную функцию чужого
роутера ради этого нельзя — общее место лучше, чем перекрёстная зависимость.
"""

from __future__ import annotations

from fastapi import Response

from .schemas import TokenPair
from .security import ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL

#: Общие для всех кук атрибуты. Раздел 11 ТЗ: httpOnly, secure, samesite=lax.
#:
#: `domain` не задаётся намеренно: кука остаётся host-only, и сессия кабинета
#: (`app.<домен>`) не уезжает на Mini App (`tma.<домен>`). Общий домен свёл бы
#: два канала с разными правилами доступа в один.
_ATTRS = {"httponly": True, "secure": True, "samesite": "lax", "path": "/"}


def set_auth_cookies(response: Response, tokens: TokenPair) -> None:
    """Положить пару токенов в куки.

    **Срок жизни задаётся явно и равен сроку самого токена.** Без `max_age` кука
    сессионная — исчезает при закрытии браузера, — и refresh-токен, подписанный
    на тридцать дней, на деле жил до конца вечера. Расхождение видно только на
    живом браузере: тесты и запросы к API его не замечают, потому что там кука
    существует ровно столько, сколько длится прогон.
    """

    response.set_cookie(
        "access_token",
        tokens.access_token,
        max_age=int(ACCESS_TOKEN_TTL.total_seconds()),
        **_ATTRS,  # type: ignore[arg-type]
    )
    response.set_cookie(
        "refresh_token",
        tokens.refresh_token,
        max_age=int(REFRESH_TOKEN_TTL.total_seconds()),
        **_ATTRS,  # type: ignore[arg-type]
    )


def clear_auth_cookies(response: Response) -> None:
    """Снять куки теми же атрибутами, какими они ставились.

    Браузер сопоставляет куки по имени, домену и пути, поэтому сегодня удаление
    сработало бы и без совпадения остальных атрибутов. Но пара «ставим с одним
    набором, снимаем с другим» переживёт не всякое обновление Starlette, а
    неудалённая кука сессии — это выход, который не вышел.
    """

    for name in ("access_token", "refresh_token"):
        response.delete_cookie(name, **_ATTRS)  # type: ignore[arg-type]
