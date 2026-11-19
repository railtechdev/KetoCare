"""The clinic letterhead: name, details and logo on every document (ADR-0092).

The administrator sets it in the cabinet; it lives in `app_settings` under two
keys. The text and the logo are separate rows: the logo is a picture of up to a
megabyte, and reading the name for a page header must not drag it along.

A document copies the letterhead when it is built (`snapshot`): a PDF issued
yesterday keeps yesterday's logo after the clinic changes it.
"""

from __future__ import annotations

import base64
import hashlib
import struct
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AppSetting

KEY_TEXT = "letterhead.text"
KEY_LOGO = "letterhead.logo"

#: Shown on documents while the clinic has not set its letterhead.
FALLBACK_NAME = "KetoCare"

LOGO_MAX_BYTES = 1024 * 1024
#: 15 mm at 300 dpi — the logo's height on the first page of a document.
LOGO_MIN_HEIGHT_PX = 180
#: Wider marks shrink to a sliver in the header box (15 mm high, 60 mm wide).
LOGO_MAX_ASPECT = 4.0
LOGO_MAX_SIDE_PX = 4096

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _blank_to_none(value: Any) -> Any:
    if isinstance(value, str):
        value = " ".join(value.split())
        return value or None
    return value


Text = Annotated[str | None, BeforeValidator(_blank_to_none)]
Required = Annotated[str, BeforeValidator(_blank_to_none)]


class LetterheadText(BaseModel):
    """What the administrator types. Only the two names are required: the Uzbek
    one by the state language law (art. 19 — letterheads are in the state
    language), the short one because running headers have room for nothing else."""

    model_config = ConfigDict(extra="forbid")

    name_uz: Required = Field(min_length=1, max_length=255)
    name_ru: Text = Field(default=None, max_length=255)
    short_name: Required = Field(min_length=1, max_length=40)
    department: Text = Field(default=None, max_length=120)
    address: Text = Field(default=None, max_length=255)
    #: Printed on the family's sheets: who to call about the diet.
    family_phone: Text = Field(default=None, max_length=40)
    contact: Text = Field(default=None, max_length=120, description="Почта или сайт")
    license: Text = Field(default=None, max_length=120, description="Номер и дата лицензии")
    #: The Uzbek taxpayer number: nine digits.
    stir: Text = Field(default=None, pattern=r"^\d{9}$")


class LogoError(ValueError):
    """The file cannot serve as a logo; the message is for the administrator."""


@dataclass(frozen=True)
class LogoInfo:
    width: int
    height: int
    size: int
    sha256: str


def png_size(data: bytes) -> tuple[int, int]:
    """Width and height from the IHDR chunk, without decoding the picture."""

    if not data.startswith(_PNG_SIGNATURE) or data[12:16] != b"IHDR" or len(data) < 24:
        raise LogoError("Нужен файл PNG. Другие форматы, в том числе SVG, не принимаются.")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def check_logo(data: bytes) -> LogoInfo:
    if len(data) > LOGO_MAX_BYTES:
        raise LogoError("Файл больше 1 МБ. Сохраните логотип меньшего размера.")
    width, height = png_size(data)
    if width == 0 or height == 0 or max(width, height) > LOGO_MAX_SIDE_PX:
        raise LogoError("Размер картинки не распознан или больше 4096 px по стороне.")
    if height < LOGO_MIN_HEIGHT_PX:
        raise LogoError(
            f"Высота логотипа {height} px — на печати он выйдет размытым. "
            f"Нужно не меньше {LOGO_MIN_HEIGHT_PX} px."
        )
    if width / height > LOGO_MAX_ASPECT:
        raise LogoError(
            "Логотип шире, чем 4 : 1, — в шапке он станет тонкой полоской. "
            "Возьмите знак без длинной надписи: название клиники печатается рядом."
        )
    return LogoInfo(width, height, len(data), hashlib.sha256(data).hexdigest())


@dataclass(frozen=True)
class StoredLogo:
    data: bytes
    info: LogoInfo
    updated_at: datetime | None


@dataclass(frozen=True)
class Stored:
    text: LetterheadText | None
    text_updated_at: datetime | None
    text_updated_by: Any
    logo: LogoInfo | None
    logo_updated_at: datetime | None


async def _row(session: AsyncSession, key: str) -> AppSetting | None:
    return await session.get(AppSetting, key)


def _text_of(row: AppSetting | None) -> LetterheadText | None:
    if row is None:
        return None
    try:
        return LetterheadText.model_validate(row.value)
    except ValueError:
        # A value written by an older version that no longer validates: the
        # documents fall back to the product name instead of failing to build.
        return None


def _logo_of(row: AppSetting | None) -> StoredLogo | None:
    if row is None:
        return None
    try:
        data = base64.b64decode(row.value["png"], validate=True)
        info = check_logo(data)
    except (KeyError, ValueError, TypeError):
        return None
    return StoredLogo(data=data, info=info, updated_at=row.updated_at)


async def read(session: AsyncSession) -> Stored:
    text_row = await _row(session, KEY_TEXT)
    logo_row = await _row(session, KEY_LOGO)
    logo = _logo_of(logo_row)
    return Stored(
        text=_text_of(text_row),
        text_updated_at=text_row.updated_at if text_row else None,
        text_updated_by=text_row.updated_by if text_row else None,
        logo=logo.info if logo else None,
        logo_updated_at=logo.updated_at if logo else None,
    )


async def read_logo(session: AsyncSession) -> StoredLogo | None:
    return _logo_of(await _row(session, KEY_LOGO))


async def _put(session: AsyncSession, key: str, value: dict[str, Any], by: Any) -> None:
    row = await _row(session, key)
    if row is None:
        session.add(AppSetting(key=key, value=value, updated_by=by))
    else:
        row.value = value
        row.updated_by = by
    await session.flush()


async def save_text(session: AsyncSession, value: LetterheadText, *, by: Any) -> None:
    await _put(session, KEY_TEXT, value.model_dump(mode="json"), by)


async def save_logo(session: AsyncSession, data: bytes, *, by: Any) -> LogoInfo:
    info = check_logo(data)
    await _put(session, KEY_LOGO, {"png": base64.b64encode(data).decode("ascii")}, by)
    return info


async def drop_logo(session: AsyncSession) -> bool:
    row = await _row(session, KEY_LOGO)
    if row is None:
        return False
    await session.delete(row)
    await session.flush()
    return True


# --- what a document carries -------------------------------------------------


class Snapshot(BaseModel):
    """The letterhead as a document prints it, copied at build time.

    Serialisable: it travels in the payload of a report job to the worker."""

    name_uz: str | None = None
    name_ru: str | None = None
    short_name: str = FALLBACK_NAME
    department: str | None = None
    address: str | None = None
    family_phone: str | None = None
    contact: str | None = None
    license: str | None = None
    stir: str | None = None
    #: The logo as a `data:` URI — a template embeds it without another request.
    logo_data_uri: str | None = None

    @property
    def configured(self) -> bool:
        return self.name_uz is not None


async def snapshot(session: AsyncSession) -> Snapshot:
    text = _text_of(await _row(session, KEY_TEXT))
    logo = await read_logo(session)
    uri = (
        "data:image/png;base64," + base64.b64encode(logo.data).decode("ascii")
        if logo is not None
        else None
    )
    if text is None:
        return Snapshot(logo_data_uri=uri)
    return Snapshot(**text.model_dump(), logo_data_uri=uri)
