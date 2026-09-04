"""Данные для сквозного прогона Playwright (раздел 15 п. 22, раздел 13 ТЗ).

Отдельно от `seed_demo.py`, хотя половина кода похожа. Причина не в аккуратности:
демо-данные существуют, чтобы экраны было на чём смотреть, и их состав меняют
свободно — под показ, под скриншот, под новую функцию. E2E же падает, как только
данные под ним поедут, и разбирать придётся не тест, а чужую правку демо-сида.

Что делает:

- заводит две учётные записи (врач и родитель) и одного ребёнка, связанного с
  обоими;
- **сбрасывает второй фактор врача.** Секрет не лежит в репозитории и не сеется:
  сброшенный второй фактор означает, что вход ответит «настройте 2FA», и тест
  пройдёт настоящую первичную настройку — получит секрет-кандидат и подтвердит
  его кодом. Заодно это единственная проверка первого входа приглашённого
  специалиста;
- проверяет, что в справочнике есть продукты, которыми можно собрать день.

Клинических данных не создаёт и не удаляет: назначение, меню и записи дневника
заводит сам тест — в этом и смысл сквозного сценария.

Запуск: `make seed-e2e` (нужен поднятый postgres).
"""

from __future__ import annotations

import asyncio
import os
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.config import get_settings
from core.models import Product, ProductCategory, User
from core.models.enums import Sex, UserRole
from core.repositories import access as access_repo
from core.repositories import patients as patients_repo
from core.repositories import products as products_repo
from core.repositories import users as users_repo

# Пароль по умолчанию годится только для локальной базы: на публичном стенде его
# обязательно перекрывает переменная окружения — тот же довод, что в `seed_demo`.
PASSWORD = os.environ.get("E2E_PASSWORD", "e2e correct horse battery staple")

#: Домен `example.com` зарезервирован RFC 2606: письмо на такой адрес не уйдёт
#: даже случайно. Именно он, а не более говорящий `example.test`: проверка
#: адреса отвергает служебные домены верхнего уровня (`.test`, `.invalid`,
#: `.localhost`) — вход просто не примет такой адрес.
DOCTOR_EMAIL = "e2e-doctor@example.com"
PARENT_EMAIL = "e2e-parent@example.com"

PATIENT_NAME = "Тест Тестова"

#: Минимум, которым можно собрать день: жир, белок и что-то с углеводами.
#: Значения — USDA, как и в демо-сиде: база продуктов кормит расчёт, и
#: происхождение чисел должно быть прослеживаемо.
PRODUCTS = [
    ("Масло сливочное E2E", 717, 81.1, 0.9, 0.1, 0.0),
    ("Яйцо куриное E2E", 143, 9.5, 12.6, 0.7, 0.0),
    ("Сливки 33% E2E", 340, 33.0, 2.5, 3.0, 0.0),
]


#: Признаки боевой базы: сид заводит врача с известным паролем и сброшенным
#: вторым фактором, а сквозной тест пишет назначение — отменить его нельзя,
#: `prescriptions` append-only. Ошибиться адресом здесь стоит дороже, чем
#: перестраховаться.
_PRODUCTION_HINTS = ("railtech", "prod", "ketocare.uz")


def _refuse_production(database_url: str) -> None:
    lowered = database_url.lower()
    hit = next((hint for hint in _PRODUCTION_HINTS if hint in lowered), None)
    if hit is None:
        return
    raise SystemExit(
        f"Адрес базы похож на боевой (в строке подключения есть «{hit}»).\n"
        "Сид прогонов заводит учётную запись врача с известным паролем и сбрасывает\n"
        "второй фактор, а сквозной тест пишет назначение. Укажите локальную базу."
    )


async def main() -> int:
    from api.security import hash_password

    database_url = get_settings().database_url
    _refuse_production(database_url)
    engine = create_async_engine(database_url)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as session:
        doctor = await _user(session, UserRole.DOCTOR, "Врач Прогонов", DOCTOR_EMAIL, hash_password)
        parent = await _user(
            session, UserRole.PARENT, "Родитель Прогонов", PARENT_EMAIL, hash_password
        )

        # Сброс второго фактора — каждый раз, а не только при создании: иначе
        # второй прогон получил бы запрос кода, которого тест не знает.
        doctor.totp_secret = None

        category = await _category(session)
        added = await _products(session, category_id=category.id, changed_by=doctor.id)
        patient = await _patient(session, parent=parent, doctor=doctor)

        await session.commit()
        patient_id = patient.id

    await engine.dispose()

    print(f"Пациент: {PATIENT_NAME} ({patient_id})")
    print(f"Продуктов добавлено: {added}")
    print(f"Врач:     {DOCTOR_EMAIL} (второй фактор сброшен)")
    print(f"Родитель: {PARENT_EMAIL}")
    return 0


async def _user(session, role: UserRole, full_name: str, email: str, hash_password) -> User:
    existing = await users_repo.get_by_email(session, email)
    if existing is not None:
        # Пароль переустанавливается: он мог смениться в прошлом прогоне или
        # прийти другим из окружения, и тогда вход упал бы без объяснения.
        existing.password_hash = hash_password(PASSWORD)
        existing.is_active = True
        return existing

    user = await users_repo.create(
        session,
        role=role,
        full_name=full_name,
        email=email,
        password_hash=hash_password(PASSWORD),
    )
    return user


async def _category(session) -> ProductCategory:
    category = await session.scalar(
        select(ProductCategory).where(ProductCategory.name_ru == "Прогонные")
    )
    if category is None:
        category = ProductCategory(name_ru="Прогонные", sort=200)
        session.add(category)
        await session.flush()
    return category


async def _products(session, *, category_id, changed_by) -> int:
    added = 0
    for name, kcal, fat, protein, carbs, fiber in PRODUCTS:
        if await session.scalar(select(Product).where(Product.name_ru == name)) is not None:
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
    """Один ребёнок на обе учётные записи.

    Именно один: `PatientGate` у семьи с двумя детьми спрашивает, о ком речь, и
    тест пришлось бы учить этому выбору ради шага, которого в сценарии нет.
    """

    linked = await access_repo.list_accessible_patient_ids(
        session, user_id=parent.id, role=UserRole.PARENT
    )
    patient = await patients_repo.get(session, linked[0]) if linked else None

    if patient is None:
        patient = await patients_repo.create(
            session,
            full_name=PATIENT_NAME,
            birth_date=date(2019, 4, 12),
            sex=Sex.F,
            height_cm=104.0,
            allergies=[],
        )
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

    doctors = await access_repo.list_accessible_patient_ids(
        session, user_id=doctor.id, role=UserRole.DOCTOR
    )
    if patient.id not in doctors:
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    return patient


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
