"""Чтение загруженного файла с пределом размера.

Общее место для импортов справочников: предел один и тот же, а вторая копия
чтения кусками однажды разойдётся с первой — и разойдётся именно в ту сторону,
где ограничение перестаёт срабатывать.
"""

from __future__ import annotations

from fastapi import UploadFile

from ..errors import ApiError, ErrorCode

#: Потолок файла импорта. Пять мегабайт — это десятки тысяч строк CSV: заметно
#: больше любой настоящей базы продуктов или сборника рецептов и заметно меньше,
#: чем нужно, чтобы занять память процесса.
MAX_IMPORT_BYTES = 5 * 1024 * 1024

#: Размер куска при чтении.
_CHUNK = 64 * 1024


async def read_within_limit(file: UploadFile, *, max_bytes: int = MAX_IMPORT_BYTES) -> bytes:
    """Читает файл, останавливаясь на превышении предела.

    Предел проверялся ПОСЛЕ `await file.read()`, то есть после того, как весь
    файл оказывался в памяти процесса. Ограничение, которое срабатывает уже
    после того, как ущерб нанесён, защищает только от аккуратных: гигабайтный
    файл сначала прочитывался целиком и лишь затем отвергался.
    """

    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(_CHUNK):
        size += len(chunk)
        if size > max_bytes:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                f"Файл больше {max_bytes // (1024 * 1024)} МБ.",
            )
        chunks.append(chunk)
    return b"".join(chunks)
