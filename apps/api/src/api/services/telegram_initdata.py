"""Проверка подписи `initData` из Telegram Mini App (раздел 13 ТЗ).

Telegram отдаёт приложению строку запроса с данными пользователя и подписью.
Подпись — HMAC-SHA256 по отсортированным парам «ключ=значение», где ключом
служит HMAC-SHA256 от токена бота с постоянной солью `WebAppData`
(https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

Это единственное доказательство, что приложение открыто в Telegram именно этим
пользователем: сама строка приходит от клиента и без проверки подписи означает
ровно столько же, сколько любой заголовок запроса. Поэтому алгоритм вынесен
отдельно и проверяется тестами напрямую — ошибка здесь означает вход в кабинет
чужого ребёнка по подделанной строке.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl

#: Срок годности подписи (раздел 13 ТЗ).
#:
#: Строка выдаётся при запуске приложения и не обновляется, поэтому час — это и
#: срок, в течение которого её можно обменять на сессию. Перехваченная строка
#: после этого бесполезна.
MAX_AGE = timedelta(hours=1)

#: Постоянная соль из документации Telegram. Не настройка: другое значение
#: означает другую схему подписи, а не другую конфигурацию.
_SALT = b"WebAppData"


class InitDataError(ValueError):
    """Строка не прошла проверку. Причина не раскрывается вызывающей стороне."""


@dataclass(frozen=True, slots=True)
class InitData:
    """Проверенное содержимое строки.

    Здесь только то, что нужно для входа: кто открыл приложение. Имя и фамилия
    из Telegram намеренно не берутся — ФИО ребёнка и родителя ведёт кабинет, а
    вторая копия имени из чужой системы однажды разойдётся с первой.
    """

    user_id: int
    auth_date: datetime


def parse_init_data(raw: str, *, bot_token: str, now: datetime | None = None) -> InitData:
    """Проверяет подпись и возвращает содержимое. Иначе — `InitDataError`.

    Отказы не различаются по тексту: по разнице «неверная подпись» и «истёк
    срок» подбирающий узнавал бы, что именно у него не так.
    """

    if not bot_token:
        raise InitDataError("Канал Mini App не настроен")

    pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=False)
    if not pairs:
        raise InitDataError("Пустая строка initData")

    fields = dict(pairs)
    if len(fields) != len(pairs):
        # Повторяющийся ключ: словарь оставил бы последнее значение, а в
        # проверочную строку по документации входят все пары. Разбирать такую
        # строку — значит проверять подпись не для тех данных, которые примем.
        raise InitDataError("Повторяющийся ключ в initData")

    signature = fields.pop("hash", "")
    if not signature:
        raise InitDataError("В initData нет подписи")

    check_string = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
    secret = hmac.new(_SALT, bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()

    # compare_digest, а не `==`: посимвольное сравнение выдаёт временем длину
    # совпавшего префикса, а подпись подбирается по одному символу.
    if not hmac.compare_digest(expected, signature):
        raise InitDataError("Подпись initData не сходится")

    auth_date = _auth_date(fields.get("auth_date", ""))
    moment = now or datetime.now(UTC)
    if not -MAX_AGE <= moment - auth_date <= MAX_AGE:
        # Верхняя граница — срок годности, нижняя — часы клиента, ушедшие
        # вперёд: подписанная строка «из будущего» не должна жить дольше часа.
        raise InitDataError("Подпись initData просрочена")

    return InitData(user_id=_user_id(fields.get("user", "")), auth_date=auth_date)


def _auth_date(raw: str) -> datetime:
    try:
        return datetime.fromtimestamp(int(raw), tz=UTC)
    except (TypeError, ValueError) as exc:
        raise InitDataError("В initData нет отметки времени") from exc


def _user_id(raw: str) -> int:
    """Идентификатор пользователя Telegram из поля `user` (это JSON внутри строки)."""

    try:
        parsed = json.loads(raw)
        return int(parsed["id"])
    except (ValueError, TypeError, KeyError) as exc:
        raise InitDataError("В initData нет пользователя") from exc
