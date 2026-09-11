"""Тесты инвариантов репозиториев — правила, нарушение которых ломает продукт
(CLAUDE.md, раздел 4.2 ТЗ). Требуют запущенный PostgreSQL (make dev)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import event

from core.models import Product, ProductCategory
from core.models.clinical import AppendOnlyViolationError
from core.models.enums import Sex, UserRole
from core.repositories import (
    access,
    audit,
    medical_profiles,
    patients,
    prescriptions,
    products,
    therapy,
    users,
)

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
            name_ru=f"Масло сливочное {uuid.uuid4().hex[:8]}",
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
        assert revisions[0].snapshot["name_ru"].startswith("Масло сливочное")
        assert revisions[0].changed_by == admin.id

    async def test_update_appends_revision_with_new_state(self, session):
        admin = await _make_user(session, UserRole.ADMIN)
        category_id = await self._category_id(session)

        product = await products.create(
            session,
            changed_by=admin.id,
            name_ru=f"Творог 5% {uuid.uuid4().hex[:8]}",
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
            name_ru=f"Брокколи свежая {uuid.uuid4().hex[:8]}",
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


class TestProductSearchFindsPartialWords:
    """Поиск обязан работать по мере ввода, а не по готовому слову.

    Было: `plainto_tsquery` ищет целыми лексемами, поэтому «мас» не находило
    ничего, и список оживал только когда «масло» набрано полностью. На базе из
    сотни продуктов это выглядит как неработающий поиск.
    """

    async def _product(self, session, name_ru: str, name_uz: str | None = None):
        from core.models import ProductCategory

        admin = await _make_user(session, UserRole.ADMIN)
        category = ProductCategory(name_ru=f"Категория {uuid.uuid4().hex[:8]}", sort=0)
        session.add(category)
        await session.flush()
        return await products.create(
            session,
            changed_by=admin.id,
            name_ru=name_ru,
            name_uz=name_uz,
            name_en="Butter, salted",
            category_id=category.id,
            kcal_100g=717,
            fat_100g=81.1,
            protein_100g=0.9,
            carbs_100g=0.1,
            fiber_100g=0.0,
            source="USDA",
            source_version="SR28",
            verified_at=date(2026, 1, 1),
        )

    async def _finds(self, session, query: str, name: str) -> bool:
        found, _ = await products.search(session, q=query)
        return any(p.name_ru == name for p in found)

    async def test_prefix_of_a_word(self, session):
        name = f"Масло сливочное {uuid.uuid4().hex[:8]}"
        await self._product(session, name)
        assert await self._finds(session, "мас", name), "поиск должен идти по мере ввода"

    async def test_middle_of_a_word(self, session):
        """То, что не решается никаким префиксным поиском, включая `to_tsquery('мас:*')`."""

        name = f"Масло сливочное {uuid.uuid4().hex[:8]}"
        await self._product(session, name)
        assert await self._finds(session, "ливоч", name)

    async def test_inflected_form_still_works(self, session):
        """Полнотекст никуда не делся: словоформы обязаны находиться."""

        name = f"Масло сливочное {uuid.uuid4().hex[:8]}"
        await self._product(session, name)
        assert await self._finds(session, "маслом", name)

    async def test_word_order_does_not_matter(self, session):
        name = f"Масло сливочное {uuid.uuid4().hex[:8]}"
        await self._product(session, name)
        assert await self._finds(session, "сливочное масло", name)

    async def test_uzbek_name_is_searched(self, session):
        """Второе имя, которое видит человек, тоже обязано находиться."""

        name = f"Масло сливочное {uuid.uuid4().hex[:8]}"
        await self._product(session, name, name_uz="Sariyog'")
        assert await self._finds(session, "sariyog", name)

    async def test_provenance_field_is_not_searched(self, session):
        """`name_en` — это описание позиции в источнике, а не название для показа.

        Иначе врач, набрав «butter», получил бы продукты, у которых такого слова
        нет ни в одном видимом ему названии.
        """

        name = f"Масло сливочное {uuid.uuid4().hex[:8]}"
        await self._product(session, name)
        assert not await self._finds(session, "salted", name)

    @pytest.mark.parametrize("query", ["100%", "жир_", "масло & сыр", "a:b", "!", "'"])
    async def test_special_characters_do_not_break_the_query(self, session, query: str):
        """Строка из формы попадает в SQL как есть.

        `to_tsquery` на таком вводе падает — поэтому используется
        `websearch_to_tsquery`; `%` и `_` экранируются, иначе «100%» означал бы
        «что угодно».
        """

        await products.search(session, q=query)


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


class TestAppendOnlyEnforcement:
    """Append-only обеспечивается не только отсутствием методов в репозитории,
    но и защитой на уровне ORM: любая случайная мутация в будущем коде упадёт."""

    async def _make_prescription(self, session):
        doctor = await _make_user(session, UserRole.DOCTOR)
        patient = await _make_patient(session)
        return await prescriptions.create(
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

    async def test_update_of_existing_prescription_raises(self, session):
        prescription = await self._make_prescription(session)

        prescription.ratio = 2.0
        with pytest.raises(AppendOnlyViolationError):
            await session.flush()

    async def test_delete_of_prescription_raises(self, session):
        prescription = await self._make_prescription(session)

        await session.delete(prescription)
        with pytest.raises(AppendOnlyViolationError):
            await session.flush()


class TestTherapyStart:
    """Два разных вопроса об одной дате (`repositories/therapy.py`).

    `started_on` — «когда началась терапия»: слово врача важнее вывода.
    `earliest_evidence_of_therapy` — «могла ли терапия уже идти»: берётся самое
    раннее свидетельство из обоих источников. Спутать их легко, а цена ошибки
    несимметрична: по второму решается судьба исходной частоты приступов.
    """

    @staticmethod
    async def _prescribe(session, patient, doctor, effective_from: date):
        return await prescriptions.create(
            session,
            patient_id=patient.id,
            ratio=4.0,
            kcal_per_day=1200,
            protein_g=25.0,
            carbs_limit_g=10.0,
            meals_per_day=3,
            author_id=doctor.id,
            effective_from=effective_from,
        )

    async def test_doctors_word_wins_for_the_start_date(self, session):
        doctor = await _make_user(session, UserRole.DOCTOR)
        patient = await _make_patient(session)
        await self._prescribe(session, patient, doctor, date(2026, 6, 1))
        await medical_profiles.upsert(
            session,
            patient_id=patient.id,
            diagnosis=None,
            epilepsy_type=None,
            onset_age_months=None,
            genetics=None,
            comorbidities=None,
            therapy_started_on=date(2026, 1, 15),
        )

        assert await therapy.started_on(session, patient_id=patient.id) == date(2026, 1, 15)

    async def test_evidence_takes_the_earliest_of_the_two(self, session):
        """Врач назвал дату ПОЗЖЕ первого назначения — свидетельство раньше.

        Так выглядит и опечатка в году, и просто противоречие в данных. Для
        вопроса «могла ли терапия уже идти» ответ здесь один: могла.
        """

        doctor = await _make_user(session, UserRole.DOCTOR)
        patient = await _make_patient(session)
        await self._prescribe(session, patient, doctor, date(2026, 2, 1))
        await medical_profiles.upsert(
            session,
            patient_id=patient.id,
            diagnosis=None,
            epilepsy_type=None,
            onset_age_months=None,
            genetics=None,
            comorbidities=None,
            therapy_started_on=date(2062, 4, 15),
        )

        assert await therapy.started_on(session, patient_id=patient.id) == date(2062, 4, 15)
        assert await therapy.earliest_evidence_of_therapy(session, patient_id=patient.id) == date(
            2026, 2, 1
        )

    async def test_no_sources_means_no_evidence(self, session):
        patient = await _make_patient(session)

        assert await therapy.started_on(session, patient_id=patient.id) is None
        assert await therapy.earliest_evidence_of_therapy(session, patient_id=patient.id) is None

    async def test_deleted_profile_is_not_read(self, session):
        """Мягко удалённый профиль не читается — как и везде.

        Случай сегодня теоретический (профиль ниоткуда мягко не удаляется), но
        фильтр здесь решает, чью дату взять, и без проверки его снятие не роняло
        бы ничего.
        """

        doctor = await _make_user(session, UserRole.DOCTOR)
        patient = await _make_patient(session)
        await self._prescribe(session, patient, doctor, date(2026, 8, 1))
        profile = await medical_profiles.upsert(
            session,
            patient_id=patient.id,
            diagnosis=None,
            epilepsy_type=None,
            onset_age_months=None,
            genetics=None,
            comorbidities=None,
            therapy_started_on=date(2026, 4, 15),
        )
        profile.deleted_at = datetime(2026, 9, 1, tzinfo=UTC)
        await session.flush()

        assert await therapy.started_on(session, patient_id=patient.id) == date(2026, 8, 1)
        assert await therapy.earliest_evidence_of_therapy(session, patient_id=patient.id) == date(
            2026, 8, 1
        )

    async def test_start_is_the_earliest_prescription_not_the_active(self, session):
        """Без слова врача начало — САМОЕ РАННЕЕ назначение, а не действующее.

        Назначение меняют по ходу лечения, и «когда началось» — это первая
        строка, а не последняя. Ошибиться легко ровно потому, что рядом лежит
        `prescriptions.get_active`, устроенный наоборот.

        Строки заводятся в обратном порядке дат намеренно: при сортировке по
        `created_at` (как у активного) тест вернул бы позднюю дату.
        """

        doctor = await _make_user(session, UserRole.DOCTOR)
        patient = await _make_patient(session)
        for effective_from in (date(2026, 6, 1), date(2026, 2, 1), date(2026, 9, 1)):
            await self._prescribe(session, patient, doctor, effective_from)

        assert await therapy.started_on(session, patient_id=patient.id) == date(2026, 2, 1)
        assert await therapy.earliest_evidence_of_therapy(session, patient_id=patient.id) == date(
            2026, 2, 1
        )

    async def test_each_answer_is_one_query(self, session):
        """По одному запросу на ответ.

        `started_on` зовёт сводка `/overview`, а главная врача собирает сводку на
        КАЖДОГО пациента списка (1 + N). Два прохода — профиль, потом назначения —
        умножались бы на когорту; на полусотне пациентов это сотня лишних
        обращений на одно открытие главной.
        """

        doctor = await _make_user(session, UserRole.DOCTOR)
        patient = await _make_patient(session)
        await self._prescribe(session, patient, doctor, date(2026, 6, 1))

        statements: list[str] = []
        engine = session.get_bind().engine

        def _count(conn, cursor, statement, params, context, executemany):  # type: ignore[no-untyped-def]
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", _count)
        try:
            await therapy.started_on(session, patient_id=patient.id)
            await therapy.earliest_evidence_of_therapy(session, patient_id=patient.id)
        finally:
            event.remove(engine, "before_cursor_execute", _count)

        assert len(statements) == 2, statements


class TestLeadingMacroSearch:
    """Отбор по ведущему макронутриенту — со стороны репозитория.

    `search` — публичная функция пакета, и зовут её не только из API: параметр
    может прийти обычной строкой, а не членом перечисления. Проверка нужна
    именно поэтому — через ручку FastAPI всегда приводит значение по типу, и
    этот путь остаётся непокрытым.
    """

    @staticmethod
    async def _product(session, category, *, name, fat, protein, carbs):
        product = Product(
            name_ru=name,
            category_id=category.id,
            kcal_100g=fat * 9 + protein * 4 + carbs * 4,
            fat_100g=fat,
            protein_100g=protein,
            carbs_100g=carbs,
            fiber_100g=0,
            source="тест",
            source_version="1",
            verified_at=date(2026, 1, 1),
        )
        session.add(product)
        await session.flush()
        return product

    async def test_macro_given_as_a_plain_string_still_filters(self, session):
        """Строка «fat» работает так же, как `LeadingMacro.FAT`.

        `LeadingMacro` — `StrEnum`, и словарь находит запись по строке наравне с
        членом перечисления. Сравнение через `is not` на этом и ломалось: жиры
        сравнивались сами с собой, выдача выходила пустой, и выглядело это не как
        поломка, а как «жировых продуктов в справочнике нет».
        """

        category = ProductCategory(name_ru=f"Тест {uuid.uuid4().hex[:8]}", sort=0)
        session.add(category)
        await session.flush()
        await self._product(
            session,
            category,
            name=f"Масло {uuid.uuid4().hex[:8]}",
            fat=81.1,
            protein=0.9,
            carbs=0.1,
        )

        found, total = await products.search(session, category_id=category.id, macro="fat")

        assert total == 1, "отбор строкой вернул пусто — сравнение членов перечисления сломано"
        assert found[0].name_ru.startswith("Масло")
