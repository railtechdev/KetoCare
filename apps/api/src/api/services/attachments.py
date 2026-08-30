"""Файлы вложений: проверка, запись на диск, чтение (ADR-0004, ADR-0013).

Здесь живёт всё, что касается байтов. Репозиторий отвечает только за строки:
слой данных не должен знать про файловую систему, а сервис — про SQL.
"""

from __future__ import annotations

import hashlib
import secrets
from pathlib import Path
from urllib.parse import quote

from core.config import get_settings

from ..errors import ApiError, ErrorCode

#: Предел на файл (ADR-0004, решение 2).
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

#: Сигнатуры разрешённых типов.
#:
#: Тип определяется по первым байтам, а не по `Content-Type` и не по расширению:
#: заголовок подделывается тривиально, расширение — тем более (OWASP File Upload
#: Cheat Sheet). Отдельной библиотеки для этого нет намеренно: разрешённых типов
#: четыре, у каждого фиксированная сигнатура, и тянуть `python-magic` (нужна
#: системная libmagic) ради четырёх констант — зависимость без обоснования
#: (раздел 16 ТЗ).
_JPEG = b"\xff\xd8\xff"
_PNG = b"\x89PNG\r\n\x1a\n"
_PDF = b"%PDF-"
_RIFF = b"RIFF"
_WEBP = b"WEBP"

#: Расширение по типу. Задаётся приложением, а не берётся из имени клиента.
EXTENSION_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}

#: Типы, которые отдаются `inline`.
#:
#: Из четырёх разрешённых опасен один: PDF открывается встроенным просмотрщиком
#: с origin кабинета. Изображения таким свойством не обладают, а фото рецепта
#: существует ради показа в `<img>` (ADR-0013, решение 4).
INLINE_MIMES = frozenset({"image/jpeg", "image/png", "image/webp"})


def detect_mime(content: bytes) -> str | None:
    """Тип по сигнатуре файла. `None` — тип не из разрешённых."""

    if content.startswith(_JPEG):
        return "image/jpeg"
    if content.startswith(_PNG):
        return "image/png"
    if content.startswith(_PDF):
        return "application/pdf"
    # WebP: "RIFF" + четыре байта длины + "WEBP".
    if content.startswith(_RIFF) and content[8:12] == _WEBP:
        return "image/webp"
    return None


def validate(content: bytes) -> str:
    """Проверяет размер и тип, возвращает распознанный MIME.

    Порядок важен: сначала размер, потом сигнатура. Наоборот — значило бы читать
    сигнатуру у файла, который и так будет отвергнут.
    """

    if len(content) == 0:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Файл пустой.")

    if len(content) > MAX_ATTACHMENT_BYTES:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Файл больше {MAX_ATTACHMENT_BYTES // (1024 * 1024)} МБ.",
        )

    mime = detect_mime(content)
    if mime is None:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Такой файл загрузить нельзя. Подойдут фотографии JPEG, PNG, WebP и документы PDF.",
        )
    return mime


def quota_bytes() -> int:
    return get_settings().attachment_quota_mb * 1024 * 1024


def assert_within_quota(used: int, incoming: int) -> None:
    """Проверяет, что новый файл помещается в квоту пациента.

    Предел на файл диск не защищает: сотня документов заполнит том так же
    надёжно, как один огромный файл. Отказ объясняет, что делать — удалить
    лишнее, — потому что «превышена квота» без этого читается как поломка.
    """

    limit = quota_bytes()
    if used + incoming > limit:
        free = max(0, limit - used)
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Не помещается: на документы этого ребёнка отведено "
            f"{limit // (1024 * 1024)} МБ, свободно {free // (1024 * 1024)} МБ. "
            "Удалите ненужные документы.",
        )


def generate_stored_name(mime: str) -> str:
    """Имя файла на диске. Генерирует приложение (ADR-0004, решение 2).

    Исходное имя не участвует в пути ни в каком виде: оно приходит от клиента и
    может содержать что угодно — от `../` до непечатаемых байтов.
    """

    return f"{secrets.token_hex(16)}{EXTENSION_BY_MIME[mime]}"


def sha256_of(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _base_dir() -> Path:
    return Path(get_settings().attachments_dir).resolve()


def write_file(stored_name: str, content: bytes) -> None:
    """Кладёт байты в каталог вложений.

    Синхронная: обращения к файловой системе блокируют цикл событий и вызываются
    через пул потоков — как и чтение отчётов.
    """

    base = _base_dir()
    base.mkdir(parents=True, exist_ok=True)
    (base / stored_name).write_bytes(content)


def resolve_file(stored_name: str) -> Path | None:
    """Путь к файлу внутри тома вложений, если он там есть.

    Имя проверяется на выход за пределы каталога, хотя приходит из базы: правило
    «имя не участвует в пути как есть» дешевле соблюсти, чем однажды обнаружить
    обратное. То же решение в `reports.py`.
    """

    base = _base_dir()
    target = (base / stored_name).resolve()
    if not target.is_relative_to(base) or not target.exists():
        return None
    return target


def content_disposition(mime: str, filename: str) -> str:
    """Заголовок отдачи.

    Изображения — `inline`, PDF — всегда вложением (ADR-0013, решение 4). Имя в
    заголовке кодируется по RFC 5987: оно пришло от семьи и содержит кириллицу,
    а голый `filename=` допускает только latin-1.
    """

    kind = "inline" if mime in INLINE_MIMES else "attachment"
    return f"{kind}; filename*=UTF-8''{quote(filename, safe='')}"
