"""Демонстрационные данные для локального стенда.

НЕ миграция и НЕ фикстура тестов: тесты работают в откатываемой транзакции и
данных после себя не оставляют, а справочники наполняет сид-миграция. Этот
скрипт нужен, чтобы экраны было на чём смотреть — при разработке и при показе.

Данные вымышленные (правило 7 CLAUDE.md: реальных ФИО в репозитории нет).
Повторный запуск безопасен: всё, что уже создано, переиспользуется.

Запуск:  make seed-demo
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.config import get_settings
from core.models import Product, ProductCategory
from core.models.enums import DiarySource, KetoneMethod, Sex, UserRole
from core.repositories import access as access_repo
from core.repositories import diary as diary_repo
from core.repositories import patients as patients_repo
from core.repositories import prescriptions as prescriptions_repo
from core.repositories import products as products_repo
from core.repositories import users as users_repo

DEMO_PASSWORD = "correct horse battery staple"

# Значения на 100 г. Источник указан честно: это данные USDA, а не выдуманные
# цифры — база продуктов кормит расчёт, и происхождение должно быть прослеживаемо.
DEMO_PRODUCTS = [
    ("Масло сливочное", 717, 81.1, 0.9, 0.1, 0.0),
    ("Масло оливковое", 884, 100.0, 0.0, 0.0, 0.0),
    ("Сливки 33%", 337, 33.0, 2.5, 3.6, 0.0),
    ("Куриная грудка", 165, 3.6, 31.0, 0.0, 0.0),
    ("Яйцо куриное", 155, 10.6, 12.6, 1.1, 0.0),
    ("Лосось", 208, 13.4, 20.4, 0.0, 0.0),
    ("Авокадо", 160, 14.7, 2.0, 8.5, 6.7),
    ("Брокколи", 34, 0.4, 2.8, 6.6, 2.6),
    ("Шпинат", 23, 0.4, 2.9, 3.6, 2.2),
    ("Сыр чеддер", 402, 33.1, 24.9, 1.3, 0.0),
    ("Миндаль", 579, 49.9, 21.2, 21.6, 12.5),
    ("Кокосовое масло", 862, 99.1, 0.0, 0.0, 0.0),
]

# Две недели наблюдений: график динамики бессмысленно смотреть на одной точке.
HISTORY_DAYS = 14


async def main() -> int:
    from api.security import hash_password

    engine = create_async_engine(get_settings().database_url)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as session:
        admin = await _user(
            session, UserRole.ADMIN, "Админ Демо", "admin@example.com", hash_password
        )
        doctor = await _user(
            session, UserRole.DOCTOR, "Иван Врач", "doctor@example.com", hash_password
        )
        parent = await _user(
            session, UserRole.PARENT, "Мария Родитель", "parent@example.com", hash_password
        )

        category = await _category(session)
        added = await _products(session, category_id=category.id, changed_by=admin.id)

        patient = await _patient(session, parent=parent, doctor=doctor)
        await _prescription(session, patient_id=patient.id, author_id=doctor.id)
        entries = await _diary(session, patient_id=patient.id, author_id=parent.id)

        await session.commit()

    await engine.dispose()

    print(f"Продуктов добавлено: {added}")
    print(f"Записей дневника добавлено: {entries}")
    print()
    print("Учётные записи (пароль у всех одинаковый):")
    print("  admin@example.com   — администратор")
    print("  doctor@example.com  — врач (при первом входе настроит 2FA)")
    print("  parent@example.com  — родитель")
    print(f"  пароль: {DEMO_PASSWORD}")
    return 0


async def _user(session, role: UserRole, full_name: str, email: str, hash_password) -> object:
    existing = await users_repo.get_by_email(session, email)
    if existing is not None:
        return existing
    return await users_repo.create(
        session,
        role=role,
        full_name=full_name,
        email=email,
        password_hash=hash_password(DEMO_PASSWORD),
    )


async def _category(session) -> ProductCategory:
    category = await session.scalar(
        select(ProductCategory).where(ProductCategory.name_ru == "Демонстрационные")
    )
    if category is None:
        category = ProductCategory(name_ru="Демонстрационные", sort=100)
        session.add(category)
        await session.flush()
    return category


async def _products(session, *, category_id, changed_by) -> int:
    added = 0
    for name, kcal, fat, protein, carbs, fiber in DEMO_PRODUCTS:
        exists = await session.scalar(select(Product).where(Product.name_ru == name))
        if exists is not None:
            continue
        await products_repo.create(
            session,
            changed_by=changed_by,
            name_ru=name,
            category_id=category_id,
            kcal_100g=kcal,
            fat_100g=fat,
            protein_100g=protein,
            carbs_100g=carbs,
            fiber_100g=fiber,
            source="USDA FoodData Central",
            source_version="SR Legacy",
            verified_at=date(2026, 1, 1),
        )
        added += 1
    return added


async def _patient(session, *, parent, doctor):
    linked = await access_repo.list_accessible_patient_ids(
        session, user_id=parent.id, role=UserRole.PARENT
    )
    if linked:
        patient = await patients_repo.get(session, linked[0])
    else:
        patient = await patients_repo.create(
            session,
            full_name="Аня Иванова",
            birth_date=date(2019, 4, 12),
            sex=Sex.F,
            height_cm=104.0,
            allergies=["Орехи"],
        )
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

    doctors_patients = await access_repo.list_accessible_patient_ids(
        session, user_id=doctor.id, role=UserRole.DOCTOR
    )
    if patient.id not in doctors_patients:
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    return patient


async def _prescription(session, *, patient_id, author_id) -> None:
    if await prescriptions_repo.get_active(session, patient_id=patient_id) is not None:
        return
    await prescriptions_repo.create(
        session,
        patient_id=patient_id,
        ratio=3.5,
        kcal_per_day=1200,
        protein_g=25.0,
        carbs_limit_g=12.0,
        meals_per_day=4,
        author_id=author_id,
        effective_from=date.today() - timedelta(days=HISTORY_DAYS),
    )


async def _diary(session, *, patient_id, author_id) -> int:
    """Две недели кетонов и веса. Значения правдоподобные, но вымышленные:
    это демонстрация интерфейса, а не клинические данные."""

    from core.models import KetoneLog, WeightLog

    # Проверка по количеству, а не «есть хоть одна запись»: иначе единственная
    # запись, созданная вручную при отладке, навсегда блокировала бы наполнение
    # истории, и график остался бы на одной точке.
    already = await session.scalar(
        select(func.count()).select_from(KetoneLog).where(KetoneLog.patient_id == patient_id)
    )
    if int(already or 0) >= HISTORY_DAYS:
        return 0

    added = 0
    base = datetime.now(UTC) - timedelta(days=HISTORY_DAYS)
    for day in range(HISTORY_DAYS):
        moment = base + timedelta(days=day, hours=8)
        # Кетоз выходит на плато за несколько дней — рост от 1.2 к 3.5 ммоль/л
        value = round(1.2 + day * 0.18, 1)
        await diary_repo.create(
            session,
            KetoneLog,
            patient_id=patient_id,
            occurred_at=moment,
            source=DiarySource.WEB,
            created_by=author_id,
            fields={"value": min(value, 4.2), "method": KetoneMethod.BLOOD},
        )
        added += 1

        if day % 3 == 0:
            await diary_repo.create(
                session,
                WeightLog,
                patient_id=patient_id,
                occurred_at=moment,
                source=DiarySource.WEB,
                created_by=author_id,
                fields={"weight_kg": round(18.4 - day * 0.02, 2)},
            )
            added += 1
    return added


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
