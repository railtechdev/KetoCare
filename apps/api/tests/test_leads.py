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


class TestProcessLead:
    """Отметка «обработана» (ADR-0072).

    Потребитель — раздел «Заявки» кабинета администратора
    (`apps/web/src/features/admin/LeadsPanel.tsx`): он читает `processed_at` в
    строке списка, отбирает `?status=new` и шлёт `PATCH {processed}`.
    """

    async def _lead_id(self, client, session, email: str) -> uuid.UUID:
        await client.post("/api/v1/leads", json={"email": email, "audience": "family"})
        lead = await _lead(session, email)
        assert lead is not None
        return lead.id

    async def test_admin_marks_and_unmarks(self, client, session, make_user, auth_headers):
        lead_id = await self._lead_id(client, session, "done@example.com")
        admin = await make_user(UserRole.ADMIN)

        response = await client.patch(
            f"/api/v1/leads/{lead_id}", json={"processed": True}, headers=auth_headers(admin)
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert set(body) == {"id", "email", "audience", "locale", "created_at", "processed_at"}
        assert body["processed_at"] is not None
        lead = await _lead(session, "done@example.com")
        assert lead is not None and lead.processed_by == admin.id

        response = await client.patch(
            f"/api/v1/leads/{lead_id}", json={"processed": False}, headers=auth_headers(admin)
        )
        assert response.status_code == 200
        assert response.json()["processed_at"] is None
        lead = await _lead(session, "done@example.com")
        assert lead is not None and lead.processed_by is None

    async def test_repeated_mark_keeps_the_first(self, client, session, make_user, auth_headers):
        lead_id = await self._lead_id(client, session, "twice@example.com")
        first = await make_user(UserRole.ADMIN)
        second = await make_user(UserRole.ADMIN)

        marked = await client.patch(
            f"/api/v1/leads/{lead_id}", json={"processed": True}, headers=auth_headers(first)
        )
        again = await client.patch(
            f"/api/v1/leads/{lead_id}", json={"processed": True}, headers=auth_headers(second)
        )

        assert again.json()["processed_at"] == marked.json()["processed_at"]
        lead = await _lead(session, "twice@example.com")
        assert lead is not None and lead.processed_by == first.id

    async def test_marking_is_audited(self, client, session, make_user, auth_headers):
        lead_id = await self._lead_id(client, session, "audit@example.com")
        admin = await make_user(UserRole.ADMIN)

        await client.patch(
            f"/api/v1/leads/{lead_id}", json={"processed": True}, headers=auth_headers(admin)
        )

        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "update",
                AuditLog.entity == "leads",
                AuditLog.entity_id == lead_id,
            )
        )
        assert entry is not None
        assert entry.user_id == admin.id
        assert entry.before == {"processed": False}
        assert entry.after == {"processed": True}

    async def test_list_filters_by_status(self, client, session, make_user, auth_headers):
        fresh = await self._lead_id(client, session, "fresh@example.com")
        answered = await self._lead_id(client, session, "answered@example.com")
        admin = await make_user(UserRole.ADMIN)
        await client.patch(
            f"/api/v1/leads/{answered}", json={"processed": True}, headers=auth_headers(admin)
        )

        new = await client.get(
            "/api/v1/leads", params={"status": "new", "limit": 200}, headers=auth_headers(admin)
        )
        processed = await client.get(
            "/api/v1/leads",
            params={"status": "processed", "limit": 200},
            headers=auth_headers(admin),
        )

        new_ids = {item["id"] for item in new.json()["items"]}
        processed_ids = {item["id"] for item in processed.json()["items"]}
        assert str(fresh) in new_ids and str(answered) not in new_ids
        assert str(answered) in processed_ids and str(fresh) not in processed_ids
        assert all(item["processed_at"] is None for item in new.json()["items"])

    async def test_unknown_status_is_rejected(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.get(
            "/api/v1/leads", params={"status": "old"}, headers=auth_headers(admin)
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    @pytest.mark.parametrize(
        "payload",
        [{}, {"processed": "может быть"}, {"processed": True, "email": "x@example.com"}],
        ids=["empty", "not-bool", "extra-field"],
    )
    async def test_validation(self, client, session, make_user, auth_headers, payload):
        lead_id = await self._lead_id(client, session, "valid@example.com")
        admin = await make_user(UserRole.ADMIN)

        response = await client.patch(
            f"/api/v1/leads/{lead_id}", json=payload, headers=auth_headers(admin)
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
        lead = await _lead(session, "valid@example.com")
        assert lead is not None and lead.processed_at is None

    async def test_missing_lead_is_404(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.patch(
            f"/api/v1/leads/{uuid.uuid4()}", json={"processed": True}, headers=auth_headers(admin)
        )
        assert response.status_code == 404

    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.PARENT, UserRole.DIETITIAN])
    async def test_other_roles_forbidden(self, client, session, make_user, auth_headers, role):
        lead_id = await self._lead_id(client, session, "nope@example.com")
        user = await make_user(role)

        response = await client.patch(
            f"/api/v1/leads/{lead_id}", json={"processed": True}, headers=auth_headers(user)
        )

        assert response.status_code == 403
        lead = await _lead(session, "nope@example.com")
        assert lead is not None and lead.processed_at is None

    async def test_anonymous_cannot_mark(self, client, session):
        lead_id = await self._lead_id(client, session, "anon@example.com")
        response = await client.patch(f"/api/v1/leads/{lead_id}", json={"processed": True})
        assert response.status_code == 401
