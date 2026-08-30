"""Заявки с посадочной страницы (ADR-0012).

Ручка публичная — единственная такая на запись, — поэтому проверяется не только
happy path, но и то, что она не превращается в открытую дверь: приманка для
ботов, ограничение частоты и закрытое чтение списка.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from core.models import AuditLog, Lead
from core.models.enums import LeadAudience, UserRole

pytestmark = pytest.mark.asyncio


async def _count(session, email: str) -> int:
    """Сколько заявок с этим адресом.

    Отбор по адресу обязателен: тесты идут во внешней транзакции с откатом, но
    в базе разработчика лежат настоящие заявки — оставленные через форму при
    ручной проверке. Без отбора тест падал не на своей ошибке, а на чужих
    данных, и «заявок ровно одна» означало «во всей базе одна».
    """

    return int(
        await session.scalar(select(func.count()).select_from(Lead).where(Lead.email == email)) or 0
    )


async def _lead(session, email: str) -> Lead | None:
    """Заявка по адресу — а не первая попавшаяся."""

    return await session.scalar(select(Lead).where(Lead.email == email))


class TestCreateLead:
    @pytest.mark.parametrize("audience", ["family", "doctor"])
    async def test_anyone_can_submit(self, client, session, audience):
        response = await client.post(
            "/api/v1/leads",
            json={"email": "Parent@Example.COM", "audience": audience, "locale": "ru"},
        )
        assert response.status_code == 202, response.text

        # Адрес нормализуется: иначе «Parent@» и «parent@» — две разные заявки.
        lead = await _lead(session, "parent@example.com")
        assert lead is not None
        assert lead.audience == LeadAudience(audience)

    async def test_locale_is_stored(self, client, session):
        await client.post(
            "/api/v1/leads",
            json={"email": "a@example.com", "audience": "family", "locale": "uz-Latn-UZ"},
        )
        lead = await _lead(session, "a@example.com")
        assert lead is not None
        assert lead.locale == "uz-Latn-UZ"

    async def test_repeated_submit_does_not_duplicate(self, client, session):
        for _ in range(3):
            response = await client.post(
                "/api/v1/leads",
                json={"email": "same@example.com", "audience": "family"},
            )
            # Ответ одинаковый каждый раз: по коду нельзя узнать, есть ли уже
            # такой адрес в базе.
            assert response.status_code == 202
        assert await _count(session, "same@example.com") == 1

    async def test_same_email_two_audiences_are_two_leads(self, client, session):
        for audience in ("family", "doctor"):
            await client.post(
                "/api/v1/leads",
                json={"email": "both@example.com", "audience": audience},
            )
        assert await _count(session, "both@example.com") == 2

    async def test_honeypot_looks_like_success_but_stores_nothing(self, client, session):
        response = await client.post(
            "/api/v1/leads",
            json={
                "email": "bot@example.com",
                "audience": "family",
                "website": "https://spam.example",
            },
        )
        assert response.status_code == 202, "боту отвечаем как всем — иначе он подберёт обход"
        assert await _count(session, "bot@example.com") == 0

    @pytest.mark.parametrize(
        "payload",
        [
            {"email": "не почта", "audience": "family"},
            {"email": "a@example.com", "audience": "investor"},
            {"audience": "family"},
        ],
        ids=["bad-email", "unknown-audience", "no-email"],
    )
    async def test_validation(self, client, session, payload):
        response = await client.post("/api/v1/leads", json=payload)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
        assert await _count(session, "bot@example.com") == 0

    async def test_rate_limited(self, client, session):
        """Лимит существует и срабатывает: открытую форму иначе заливают мусором."""

        codes = []
        for i in range(25):
            response = await client.post(
                "/api/v1/leads",
                json={"email": f"user{i}@example.com", "audience": "family"},
            )
            codes.append(response.status_code)

        assert 429 in codes, "ограничение частоты не сработало"
        assert codes.index(429) >= 20, "лимит сработал раньше объявленных 20 запросов в час"


class TestListLeads:
    async def test_admin_reads_leads(self, client, session, make_user, auth_headers):
        await client.post("/api/v1/leads", json={"email": "a@example.com", "audience": "doctor"})
        admin = await make_user(UserRole.ADMIN)

        response = await client.get("/api/v1/leads", headers=auth_headers(admin))
        assert response.status_code == 200, response.text
        # Проверяется присутствие своей заявки, а не общее число: в базе
        # разработчика лежат настоящие заявки с формы, и «ровно одна» означало
        # бы «во всей базе одна».
        emails = [item["email"] for item in response.json()["items"]]
        assert "a@example.com" in emails

    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.PARENT, UserRole.DIETITIAN])
    async def test_other_roles_forbidden(self, client, make_user, auth_headers, role):
        user = await make_user(role)
        response = await client.get("/api/v1/leads", headers=auth_headers(user))
        assert response.status_code == 403

    async def test_anonymous_cannot_read(self, client):
        """Список — это чужие контакты. Писать может кто угодно, читать — нет."""

        response = await client.get("/api/v1/leads")
        assert response.status_code == 401


class TestDeleteLead:
    """Человек вправе попросить убрать свой контакт — способ должен быть."""

    async def test_admin_deletes_lead(self, client, session, make_user, auth_headers):
        await client.post("/api/v1/leads", json={"email": "bye@example.com", "audience": "family"})
        admin = await make_user(UserRole.ADMIN)
        lead = await _lead(session, "bye@example.com")
        assert lead is not None

        response = await client.delete(f"/api/v1/leads/{lead.id}", headers=auth_headers(admin))
        assert response.status_code == 204, response.text
        assert await _count(session, "bye@example.com") == 0

    async def test_missing_lead_is_404(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.delete(f"/api/v1/leads/{uuid.uuid4()}", headers=auth_headers(admin))
        assert response.status_code == 404

    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.PARENT, UserRole.DIETITIAN])
    async def test_other_roles_cannot_delete(self, client, session, make_user, auth_headers, role):
        await client.post("/api/v1/leads", json={"email": "keep@example.com", "audience": "family"})
        user = await make_user(role)
        lead = await _lead(session, "keep@example.com")
        assert lead is not None

        response = await client.delete(f"/api/v1/leads/{lead.id}", headers=auth_headers(user))
        assert response.status_code == 403
        assert await _count(session, "keep@example.com") == 1


async def _leads_audit_count(session) -> int:
    """Сколько записей журнала о заявках уже есть.

    Тесты идут во внешней транзакции с откатом, но в базе разработчика лежат
    записи от ручной работы с кабинетом — и они видны запросу. Поэтому
    проверяется прирост, а не абсолютное значение: иначе тест падает не на
    своей ошибке, а на чужих данных.
    """

    return len(list(await session.scalars(select(AuditLog).where(AuditLog.entity == "leads"))))


class TestAudit:
    """Список заявок — это контакты семей, где `audience=family` сам по себе
    говорит о болезни ребёнка. Чтение и удаление такой базы журналируются."""

    async def test_listing_is_audited(self, client, session, make_user, auth_headers):
        await client.post("/api/v1/leads", json={"email": "a@example.com", "audience": "family"})
        admin = await make_user(UserRole.ADMIN)

        await client.get("/api/v1/leads", headers=auth_headers(admin))

        # Отбор по автору: записи о выгрузке заявок от прежней ручной работы с
        # админкой лежат в той же таблице.
        entry = await session.scalar(
            select(AuditLog).where(AuditLog.action == "export", AuditLog.user_id == admin.id)
        )
        assert entry is not None

    async def test_deletion_is_audited(self, client, session, make_user, auth_headers):
        await client.post("/api/v1/leads", json={"email": "b@example.com", "audience": "doctor"})
        admin = await make_user(UserRole.ADMIN)
        lead = await session.scalar(select(Lead).where(Lead.email == "b@example.com"))
        assert lead is not None

        await client.delete(f"/api/v1/leads/{lead.id}", headers=auth_headers(admin))

        # Отбор по самой записи, а не только по действию: иначе находится чужое
        # удаление, и тест подтверждает не то, что проверял.
        entry = await session.scalar(
            select(AuditLog).where(AuditLog.action == "delete", AuditLog.entity_id == lead.id)
        )
        assert entry is not None

    async def test_public_submit_is_not_audited(self, client, session):
        """Записи о заявке в журнале быть не должно: пользователя, от чьего
        имени её писать, не существует (ADR-0012)."""

        before = await _leads_audit_count(session)

        await client.post("/api/v1/leads", json={"email": "c@example.com", "audience": "family"})

        assert await _leads_audit_count(session) == before
