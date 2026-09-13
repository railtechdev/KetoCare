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
import os
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
from core.tools.db_guard import refuse_foreign_database

# Дефолт годится только для локальной БД. На публичном стенде пароль из
# репозитория — это открытая админка, поэтому там его обязательно перекрывает
# переменная окружения (docs/DEPLOY.md, «Демо-данные и фокус-группа»).
_PASSWORD_VAR = "DEMO_PASSWORD"
DEMO_PASSWORD = os.environ.get(_PASSWORD_VAR, "correct horse battery staple")

#: Явное разрешение на нелокальную базу. Значением задаётся САМ хост, а не «1»:
#: подтверждение должно быть конкретным. Переменная СВОЯ, не общая с сидом
#: прогонов: одно разрешение не должно открывать сразу два скрипта.
_ALLOW_HOST = "DEMO_SEED_ALLOW"

#: Чем опасен ИМЕННО этот сид на чужой базе. До этой проверки его удерживала
#: фраза в комментарии «в бою этот скрипт не запускается» — правило, жившее в
#: тексте и ни в одном исполняемом виде, при том что docs/DEPLOY.md запуск на
#: стенде прямо предписывает.
_DANGER = (
    "Демо-сид заводит администратора и врача с паролем по умолчанию из\n"
    "репозитория — на чужой базе это открытая админка. Ещё он снимает\n"
    "второй фактор учёткам с теми же адресами и пишет ребёнку НАЗНАЧЕНИЕ:\n"
    "его не отменить, prescriptions append-only, а убрать запись можно\n"
    "только через `core.tools.erase_patient`. На стенде запуск законен, но\n"
    "команда там другая — docs/DEPLOY.md, «Демо-данные и фокус-группа»."
)


def _refuse_production(database_url: str) -> None:
    """Проверка адреса общая с сидом прогонов (`core.tools.db_guard`).

    Своё здесь только описание опасности и имя переменной.

    Имя службы боевого compose (`postgres`) разрешением открывается — и надо
    называть вещи своими именами: это открывает ИМЕННО боевую базу. Признаки
    боевой строки её не ловят, в ней их нет вовсе (`@postgres:5432/ketocare`).
    После `DEMO_SEED_ALLOW=postgres` от боевой базы отделяет только то, что
    человек набрал это слово сам. Плата осознанная: демо-данные на стенд
    ставят по документу (docs/DEPLOY.md, «Демо-данные и фокус-группа»), и
    глухой запрет сломал бы законный путь, а не чужой.
    """
    refuse_foreign_database(
        database_url,
        allow_var=_ALLOW_HOST,
        danger=_DANGER,
        command="make seed-demo",
        allow_compose_names=True,
    )


def _require_password_on_allowed_host() -> None:
    """Разрешил нелокальную базу — задай пароль.

    Обязательность `DEMO_PASSWORD` жила только во фразе docs/DEPLOY.md — то
    есть была последним в этой команде правилом без исполняемого вида, ровно
    того класса, что закрыт для адреса базы. Без переменной команда со стенда
    заводит `admin@example.com` с паролем из ОТКРЫТОГО репозитория и печатает
    его в журнал.

    Требование привязано к разрешению, а не ко всем запускам: на локальной
    базе умолчание — удобство, и ломать `make seed-demo` незачем. Окружение
    читается в момент вызова, а не при импорте: иначе проверка зависела бы от
    того, когда модуль загрузили.
    """
    if os.environ.get(_ALLOW_HOST, "").strip() == "":
        return
    if os.environ.get(_PASSWORD_VAR, "").strip() != "":
        return
    raise SystemExit(
        f"База разрешена переменной {_ALLOW_HOST}, а {_PASSWORD_VAR} не задан.\n"
        "Тогда демо-админка (`admin@example.com`) получит пароль по умолчанию\n"
        "из открытого репозитория, и он же будет напечатан в журнал команды.\n"
        f"Задайте {_PASSWORD_VAR} той же командой — docs/DEPLOY.md,\n"
        "«Демо-данные и фокус-группа»."
    )


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

    database_url = get_settings().database_url
    _refuse_production(database_url)
    _require_password_on_allowed_host()
    engine = create_async_engine(database_url)
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

        # Второй фактор демо-учёток сбрасывается при КАЖДОМ прогоне, как это уже
        # делает сид прогонов (`seed_e2e`). Иначе демо-стенд одноразовый: врач и
        # администратор настраивают 2FA на чей-то телефон при первом входе, и
        # любой следующий человек — или та же машина через месяц — упирается в
        # запрос кода, которого никто не знает. Учётки демонстрационные, а
        # чужую базу отводит проверка адреса выше — не обещание в комментарии.
        for staff in (admin, doctor):
            staff.totp_secret = None
            staff.totp_pending_secret = None

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
    print("  admin@example.com   — администратор (второй фактор сброшен)")
    print("  doctor@example.com  — врач (второй фактор сброшен)")
    print("  parent@example.com  — родитель")
    # Заданный человеком пароль в журнал не печатается: на стенде этот вывод
    # уходит в консоль команды и в её журнал, а знает его и так тот, кто задал.
    if os.environ.get(_PASSWORD_VAR, "").strip() != "":
        print(f"  пароль: задан переменной {_PASSWORD_VAR}")
    else:
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
