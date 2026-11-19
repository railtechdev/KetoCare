"""`/letterhead` and `/admin/letterhead` — the clinic letterhead (ADR-0092)."""

from __future__ import annotations

import struct
import zlib

import pytest
import pytest_asyncio
from sqlalchemy import select

from core import letterhead
from core.models import AuditLog
from core.models.enums import UserRole

URL = "/api/v1/letterhead"
ADMIN_URL = "/api/v1/admin/letterhead"

TEXT = {
    "name_uz": "  «Namuna» bolalar   nevrologiya markazi ",
    "name_ru": "Детский неврологический центр «Образец»",
    "short_name": "ДНЦ «Образец»",
    "department": "",
    "address": "г. Ташкент, ул. Образцовая, 1",
    "family_phone": "+998 71 000-00-00",
    "contact": "info@obrazec.example",
    "license": "№ 00000 от 01.02.2023",
    "stir": "123456789",
}


def png(width: int, height: int) -> bytes:
    """A real, decodable greyscale PNG of the given size."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"".join(b"\x00" + b"\xff" * width for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


@pytest_asyncio.fixture
async def admin(make_user):
    return await make_user(UserRole.ADMIN)


def upload(data: bytes, name: str = "logo.png") -> dict:
    return {"file": (name, data, "image/png")}


class TestAccess:
    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.PARENT])
    async def test_only_the_administrator_writes(self, client, make_user, auth_headers, role):
        headers = auth_headers(await make_user(role))

        assert (await client.put(ADMIN_URL, json=TEXT, headers=headers)).status_code == 403
        assert (
            await client.put(f"{ADMIN_URL}/logo", files=upload(png(400, 200)), headers=headers)
        ).status_code == 403
        assert (await client.delete(f"{ADMIN_URL}/logo", headers=headers)).status_code == 403

    @pytest.mark.parametrize(
        "role", [UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.PARENT, UserRole.ADMIN]
    )
    async def test_everyone_signed_in_reads(self, client, make_user, auth_headers, role):
        """Documents are built for families and specialists alike."""

        response = await client.get(URL, headers=auth_headers(await make_user(role)))

        assert response.status_code == 200

    async def test_anonymous_is_refused(self, client) -> None:
        assert (await client.get(URL)).status_code == 401
        assert (await client.get(f"{URL}/logo")).status_code == 401


class TestText:
    async def test_empty_until_saved(self, client, admin, auth_headers) -> None:
        body = (await client.get(URL, headers=auth_headers(admin))).json()

        assert body == {
            "text": None,
            "logo": None,
            "fallback_name": "KetoCare",
            "updated_at": None,
        }

    async def test_saved_text_is_read_back_trimmed(
        self, client, admin, make_user, auth_headers
    ) -> None:
        response = await client.put(ADMIN_URL, json=TEXT, headers=auth_headers(admin))

        assert response.status_code == 200
        doctor = await make_user(UserRole.DOCTOR)
        text = (await client.get(URL, headers=auth_headers(doctor))).json()["text"]
        assert text["name_uz"] == "«Namuna» bolalar nevrologiya markazi"
        # A blank field is "not set", not an empty line on the letterhead.
        assert text["department"] is None
        assert text["stir"] == "123456789"

    @pytest.mark.parametrize(
        ("field", "value"),
        [("name_uz", ""), ("short_name", "   "), ("short_name", "x" * 41), ("stir", "12345")],
    )
    async def test_required_and_bounded_fields(
        self, client, admin, auth_headers, field, value
    ) -> None:
        response = await client.put(
            ADMIN_URL, json={**TEXT, field: value}, headers=auth_headers(admin)
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_unknown_field_is_refused(self, client, admin, auth_headers) -> None:
        response = await client.put(
            ADMIN_URL, json={**TEXT, "logo_url": "https://x"}, headers=auth_headers(admin)
        )

        assert response.status_code == 422

    async def test_every_save_is_audited(self, client, session, admin, auth_headers) -> None:
        await client.put(ADMIN_URL, json=TEXT, headers=auth_headers(admin))
        await client.put(ADMIN_URL, json={**TEXT, "short_name": "ДНЦ"}, headers=auth_headers(admin))

        rows = (
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.entity == "app_settings", AuditLog.user_id == admin.id
                )
            )
        ).all()
        assert len(rows) == 2
        # One transaction in tests: the rows share `created_at`, so no order.
        first, second = sorted(rows, key=lambda row: row.before is not None)
        assert first.before is None
        assert second.before["short_name"] == "ДНЦ «Образец»"
        assert second.after["short_name"] == "ДНЦ"
        assert second.after["key"] == "letterhead.text"


class TestLogo:
    async def test_upload_read_and_remove(self, client, admin, make_user, auth_headers) -> None:
        data = png(400, 200)
        response = await client.put(
            f"{ADMIN_URL}/logo", files=upload(data), headers=auth_headers(admin)
        )

        assert response.status_code == 200
        logo = response.json()["logo"]
        assert (logo["width"], logo["height"], logo["size"]) == (400, 200, len(data))

        parent = auth_headers(await make_user(UserRole.PARENT))
        picture = await client.get(f"{URL}/logo", headers=parent)
        assert picture.status_code == 200
        assert picture.headers["content-type"] == "image/png"
        assert picture.headers["etag"] == f'"{logo["sha256"]}"'
        assert picture.content == data

        removed = await client.delete(f"{ADMIN_URL}/logo", headers=auth_headers(admin))
        assert removed.json()["logo"] is None
        assert (await client.get(f"{URL}/logo", headers=parent)).status_code == 404

    @pytest.mark.parametrize(
        ("data", "phrase"),
        [
            (b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "PNG"),
            (b"\xff\xd8\xff\xe0" + b"\x00" * 100, "PNG"),
            (png(400, 120), "180 px"),
            (png(900, 200), "4 : 1"),
        ],
        ids=["svg", "jpeg", "too-low", "too-wide"],
    )
    async def test_unfit_files_are_explained(
        self, client, admin, auth_headers, data, phrase
    ) -> None:
        response = await client.put(
            f"{ADMIN_URL}/logo", files=upload(data), headers=auth_headers(admin)
        )

        assert response.status_code == 422
        assert phrase in response.json()["error"]["message"]

    async def test_oversized_file_is_refused(self, client, admin, auth_headers) -> None:
        data = png(400, 200) + b"\x00" * letterhead.LOGO_MAX_BYTES

        response = await client.put(
            f"{ADMIN_URL}/logo", files=upload(data), headers=auth_headers(admin)
        )

        assert response.status_code == 422
        assert "1 МБ" in response.json()["error"]["message"]

    async def test_upload_and_removal_are_audited(
        self, client, session, admin, auth_headers
    ) -> None:
        await client.put(
            f"{ADMIN_URL}/logo", files=upload(png(400, 200)), headers=auth_headers(admin)
        )
        await client.delete(f"{ADMIN_URL}/logo", headers=auth_headers(admin))
        # Removing what is not there writes nothing.
        await client.delete(f"{ADMIN_URL}/logo", headers=auth_headers(admin))

        rows = (
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.entity == "app_settings", AuditLog.user_id == admin.id
                )
            )
        ).all()
        by_action = {row.action: row for row in rows}
        assert sorted(by_action) == ["delete", "update"] and len(rows) == 2
        assert by_action["update"].after["width"] == 400
        assert by_action["delete"].before["width"] == 400
        # The picture itself never goes into the journal.
        assert "png" not in by_action["update"].after


class TestSnapshot:
    async def test_falls_back_to_the_product_name(self, session) -> None:
        snap = await letterhead.snapshot(session)

        assert snap.short_name == "KetoCare"
        assert not snap.configured
        assert snap.logo_data_uri is None

    async def test_carries_text_and_logo(self, client, session, admin, auth_headers) -> None:
        await client.put(ADMIN_URL, json=TEXT, headers=auth_headers(admin))
        await client.put(
            f"{ADMIN_URL}/logo", files=upload(png(400, 200)), headers=auth_headers(admin)
        )

        snap = await letterhead.snapshot(session)

        assert snap.configured
        assert snap.short_name == "ДНЦ «Образец»"
        assert snap.logo_data_uri is not None
        assert snap.logo_data_uri.startswith("data:image/png;base64,iVBOR")

    async def test_ai_settings_do_not_read_the_logo(self, session, admin) -> None:
        """The AI registry shares the table; it must not drag the picture along."""

        from core import app_settings

        await letterhead.save_logo(session, png(400, 200), by=admin.id)
        app_settings.clear_cache()

        rows = await app_settings._rows(session)

        assert all(key.startswith("ai.") for key in rows)
