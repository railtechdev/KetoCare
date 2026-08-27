"""Тесты инвариантов репозиториев — правила, нарушение которых ломает продукт
(CLAUDE.md, раздел 4.2 ТЗ). Требуют запущенный PostgreSQL (make dev)."""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from core.models.enums import Sex, UserRole
from core.repositories import access, audit, patients, prescriptions, products, users

pytestmark = pytest.mark.asyncio


async def _make_user(session, role: UserRole, email: str | None = None):
    return await users.create(
        session,
        role=role,
        full_name=f"Тест {role.value}",
        email=email or f"{role.value}-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="argon2-placeholder",
    )


async def _make_patient(session):
    return await patients.create(
        session, full_name="Тестовый Ребёнок", birth_date=date(2018, 5, 1), sex=Sex.M
    )


class TestPrescriptionsAppendOnly:
    """Правило 4 CLAUDE.md: prescriptions — append-only, активное = последнее по created_at."""

    async def test_new_version_does_not_mutate_previous(self, session):
        doctor = await _make_user(session, UserRole.DOCTOR)
        patient = await _make_patient(session)

        first = await prescriptions.create(
            session,
            patient_id=patient.id,
            ratio=4.0,
            kcal_per_day=1200,
            protein_g=25.0,
            carbs_limit_g=10.0,
            meals_per_day=3,
            author_id=doctor.id,
            effective_from=date(2026, 1, 1),
        )
        first_id, first_ratio = first.id, first.ratio

        second = await prescriptions.create(
            session,
            patient_id=patient.id,
            ratio=3.0,
            kcal_per_day=1300,
            protein_g=28.0,
            carbs_limit_g=12.0,
            meals_per_day=4,
            author_id=doctor.id,
            effective_from=date(2026, 2, 1),
        )

        assert second.id != first_id
        assert first.ratio == first_ratio, "старая версия назначения не должна меняться"

        history, total = await prescriptions.list_history(session, patient_id=patient.id)
        assert total == 2
        assert {p.id for p in history} == {first_id, second.id}

    async def test_get_active_returns_latest(self, session):
        doctor = await _make_user(session, UserRole.DOCTOR)
        patient = await _make_patient(session)

        for ratio in (4.0, 3.5, 3.0):
            await prescriptions.create(
                session,
                patient_id=patient.id,
                ratio=ratio,
                kcal_per_day=1200,
                protein_g=25.0,
                carbs_limit_g=10.0,
                meals_per_day=3,
                author_id=doctor.id,
                effective_from=date(2026, 1, 1),
            )

        active = await prescriptions.get_active(session, patient_id=patient.id)
        assert active is not None
        assert float(active.ratio) == 3.0, "активное назначение — последнее созданное"

    async def test_repository_exposes_no_update_or_delete(self):
        """Append-only обеспечивается отсутствием методов, а не дисциплиной вызывающего."""
        forbidden = {"update", "delete", "remove", "edit", "patch"}
        exposed = {name for name in dir(prescriptions) if not name.startswith("_")}
        assert not (forbidden & exposed), f"prescriptions не должен иметь: {forbidden & exposed}"


class TestPatientAccess:
    """Правило 5 CLAUDE.md: доступ проверяется на сервере; админ к клинике доступа не имеет."""

    async def test_parent_sees_only_own_child(self, session):
        parent = await _make_user(session, UserRole.PARENT)
        own_child = await _make_patient(session)
        other_child = await _make_patient(session)
        await patients.link_parent(session, parent_id=parent.id, patient_id=own_child.id)

        assert await access.user_has_patient_access(
            session, user_id=parent.id, role=UserRole.PARENT, patient_id=own_child.id
        )
        assert not await access.user_has_patient_access(
            session, user_id=parent.id, role=UserRole.PARENT, patient_id=other_child.id
        )

    async def test_doctor_sees_only_attached_patient(self, session):
        doctor = await _make_user(session, UserRole.DOCTOR)
        attached = await _make_patient(session)
        not_attached = await _make_patient(session)
        await patients.link_doctor(session, doctor_id=doctor.id, patient_id=attached.id)

        assert await access.user_has_patient_access(
            session, user_id=doctor.id, role=UserRole.DOCTOR, patient_id=attached.id
        )
        assert not await access.user_has_patient_access(
            session, user_id=doctor.id, role=UserRole.DOCTOR, patient_id=not_attached.id
        )

    async def test_admin_has_no_clinical_access_even_when_linked(self, session):
        """Админ не получает доступ, даже если строка связи существует."""
        admin = await _make_user(session, UserRole.ADMIN)
        patient = await _make_patient(session)
        await patients.link_doctor(session, doctor_id=admin.id, patient_id=patient.id)
        await patients.link_parent(session, parent_id=admin.id, patient_id=patient.id)

        assert not await access.user_has_patient_access(
            session, user_id=admin.id, role=UserRole.ADMIN, patient_id=patient.id
        )
        assert (
            await access.list_accessible_patient_ids(session, user_id=admin.id, role=UserRole.ADMIN)
            == []
        )

    async def test_parent_link_does_not_grant_doctor_scope(self, session):
        """Роль определяет, какая таблица связи проверяется: родительская связь
        не должна давать доступ при роли doctor."""
        user = await _make_user(session, UserRole.PARENT)
        patient = await _make_patient(session)
        await patients.link_parent(session, parent_id=user.id, patient_id=patient.id)

        assert not await access.user_has_patient_access(
            session, user_id=user.id, role=UserRole.DOCTOR, patient_id=patient.id
        )


class TestProductRevisions:
    """Раздел 4.2 ТЗ: ревизия пишется при каждом изменении products."""

    async def _category_id(self, session):
        from core.models import ProductCategory

        category = ProductCategory(name_ru="Тестовая категория", sort=0)
        session.add(category)
        await session.flush()
        return category.id

    async def test_create_writes_first_revision(self, session):
        admin = await _make_user(session, UserRole.ADMIN)
        category_id = await self._category_id(session)

        product = await products.create(
            session,
            changed_by=admin.id,
            name_ru="Масло сливочное",
            category_id=category_id,
            kcal_100g=717,
            fat_100g=81.1,
            protein_100g=0.9,
            carbs_100g=0.1,
            fiber_100g=0.0,
            source="USDA",
            source_version="SR28",
            verified_at=date(2026, 1, 1),
        )

        revisions = await products.list_revisions(session, product_id=product.id)
        assert len(revisions) == 1
        assert revisions[0].snapshot["name_ru"] == "Масло сливочное"
        assert revisions[0].changed_by == admin.id

    async def test_update_appends_revision_with_new_state(self, session):
        admin = await _make_user(session, UserRole.ADMIN)
        category_id = await self._category_id(session)

        product = await products.create(
            session,
            changed_by=admin.id,
            name_ru="Творог 5%",
            category_id=category_id,
            kcal_100g=121,
            fat_100g=5.0,
            protein_100g=17.0,
            carbs_100g=1.8,
            fiber_100g=0.0,
            source="USDA",
            source_version="SR28",
            verified_at=date(2026, 1, 1),
        )
        await products.update(session, product=product, changed_by=admin.id, fat_100g=5.5)

        revisions = await products.list_revisions(session, product_id=product.id)
        assert len(revisions) == 2, "каждое изменение пишет отдельную ревизию"
        assert float(revisions[0].snapshot["fat_100g"]) == 5.5

    async def test_search_by_fulltext(self, session):
        admin = await _make_user(session, UserRole.ADMIN)
        category_id = await self._category_id(session)
        await products.create(
            session,
            changed_by=admin.id,
            name_ru="Брокколи свежая",
            category_id=category_id,
            kcal_100g=34,
            fat_100g=0.4,
            protein_100g=2.8,
            carbs_100g=6.6,
            fiber_100g=2.6,
            source="USDA",
            source_version="SR28",
            verified_at=date(2026, 1, 1),
        )

        found, total = await products.search(session, q="брокколи")
        assert total >= 1
        assert any("Брокколи" in p.name_ru for p in found)


class TestAuditLog:
    async def test_writes_entry_with_before_after(self, session):
        admin = await _make_user(session, UserRole.ADMIN)
        entity_id = uuid.uuid4()

        entry = await audit.write_audit_log(
            session,
            user_id=admin.id,
            action="update",
            entity="products",
            entity_id=entity_id,
            before={"fat_100g": 5.0},
            after={"fat_100g": 5.5},
            ip="127.0.0.1",
        )

        assert entry.id is not None
        assert entry.before == {"fat_100g": 5.0}
        assert entry.after == {"fat_100g": 5.5}
        assert entry.created_at is not None
