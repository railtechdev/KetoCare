"""Данные для сквозного прогона Playwright (раздел 15 п. 22, раздел 13 ТЗ).

Отдельно от `seed_demo.py`, хотя половина кода похожа. Причина не в аккуратности:
демо-данные существуют, чтобы экраны было на чём смотреть, и их состав меняют
свободно — под показ, под скриншот, под новую функцию. E2E же падает, как только
данные под ним поедут, и разбирать придётся не тест, а чужую правку демо-сида.

Что делает:

- заводит две учётные записи (врач и родитель) и одного ребёнка, связанного с
  обоими;
- **задаёт второй фактор врача** известным секретом (`E2E_TOTP_SECRET`, то же
  значение читает прогон). Так состояние живёт только в базе: прежде сид
  обнулял секрет, тест настраивал его сам и хранил у себя, и расхождение этих
  двух мест давало отказ входа без объяснимой причины;
- **заводит второго врача, которому второй фактор ещё предстоит настроить.**
  Первичный вход приглашённого специалиста — одноразовое событие, и на основном
  враче его можно было бы проверить лишь однажды; здесь он проверяется каждым
  прогоном, отдельным тестом (`tests/login.spec.ts`);
- проверяет, что в справочнике есть продукты, которыми можно собрать день.

Клинических данных не создаёт и не удаляет: назначение, меню и записи дневника
заводит сам тест — в этом и смысл сквозного сценария.

Запуск: `make seed-e2e` (нужен поднятый postgres).
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import Callable
from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import get_settings
from core.models import Patient, Product, ProductCategory, User, UserBackupCode
from core.models.enums import Sex, UserRole
from core.repositories import access as access_repo
from core.repositories import patients as patients_repo
from core.repositories import products as products_repo
from core.repositories import users as users_repo
from core.tools.db_guard import MIN_PASSWORD_LENGTH, refuse_foreign_database

# Пароль по умолчанию годится только для локальной базы: на публичном стенде его
# обязательно перекрывает переменная окружения — тот же довод, что в `seed_demo`.
_PASSWORD_VAR = "E2E_PASSWORD"
_PASSWORD_DEFAULT = "e2e correct horse battery staple"

#: Домен `example.com` зарезервирован RFC 2606: письмо на такой адрес не уйдёт
#: даже случайно. Именно он, а не более говорящий `example.test`: проверка
#: адреса отвергает служебные домены верхнего уровня (`.test`, `.invalid`,
#: `.localhost`) — вход просто не примет такой адрес.
DOCTOR_EMAIL = "e2e-doctor@example.com"
# Врач, которому второй фактор ещё предстоит настроить: первичная настройка —
# одноразовое событие, и на основном враче её можно было бы проверить лишь
# однажды. Здесь она проверяется каждым прогоном, отдельным тестом.
DOCTOR_SETUP_EMAIL = "e2e-doctor-setup@example.com"
# Второй фактор врача прогона задан, а не настраивается на ходу: тот же секрет
# читает прогон (`E2E_TOTP_SECRET`), поэтому состояние живёт только в базе.
# Значение фиктивное и годится лишь для локальной базы — как и пароль выше.
_TOTP_VAR = "E2E_TOTP_SECRET"
_TOTP_DEFAULT = "KETOCAREE2ETOTPSECRET234567ABCDE"

#: Секрет второго фактора нельзя мерить парольной меркой: двенадцать символов
#: base32 — это 60 бит, вдвое меньше нижней границы RFC 4226 §4 («shared secret
#: … at least 128 bits, 160 bits RECOMMENDED»). 128 бит — это 26 символов
#: base32, а умолчание выше длиной 32 символа и есть рекомендованные 160 бит.
#: Решение техническое, принято по стандарту; медицинского вопроса здесь нет.
MIN_TOTP_CHARS = 26

#: Алфавит base32 (RFC 4648). Знаки вне него ломают разбор секрета: на `0`,
#: `1`, `8`, `9` и дефисе `pyotp` бросает `Non-base32 digit found`, а
#: `apps/e2e/src/totp.ts` — «Не base32», и вход упал бы «Неверный код
#: подтверждения» без объяснимой причины.
#:
#: РЕГИСТР при этом не важен: `pyotp` декодирует с `casefold=True`, а прогон
#: сам приводит секрет к верхнему — отвергать строчный значило бы отказывать
#: рабочему значению.
#:
#: ЗНАК РАВЕНСТВА запрещён, и довод здесь точный, потому что три предыдущие
#: редакции этого комментария были шире измеренного. Канонически дополненную
#: строку (`"A" * 26 + "======"`) принимают ОБЕ стороны и дают один код —
#: паддинг в поле секрета просто бесполезен. А вот там, где паддинг не
#: образует валидного блока (`"A" * 25 + "="`, умолчание с приписанным `=`),
#: стороны РАСХОДЯТСЯ: `totp.ts` срезает хвостовые `=` и код считает, а
#: `pyotp` падает `Incorrect padding`. Секрет, с которым прогон входит, а
#: сервер не пускает, хуже отсутствующего, поэтому `=` не принимается вовсе.
_TOTP_ALPHABET = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

#: Сколько знаков может остаться в последнем, неполном блоке base32: восемь
#: знаков кодируют пять байт, и других остатков `b32decode` не принимает.
_BASE32_BLOCK_TAILS = frozenset({0, 2, 4, 5, 7})


def _password() -> str:
    """Пароль учёток прогона — одним источником, читаемым при обращении.

    Снимок при импорте означал бы, что проверка ниже удостоверяет не то
    значение, которое потом хешируется: разойтись они могли бы только по
    порядку загрузки модуля, но утверждение «проверено» держалось бы на нём, а
    не на коде (замечание ревью PR #195 — там это уже исправлено у демо-сида).
    """
    return os.environ.get(_PASSWORD_VAR, "").strip() or _PASSWORD_DEFAULT


def _totp_secret() -> str:
    """Секрет второго фактора врача — тем же правилом, что и пароль."""
    return os.environ.get(_TOTP_VAR, "").strip() or _TOTP_DEFAULT


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


#: Явное разрешение для случая, которого белый список не покрывает (своя база на
#: другом хосте). Значением задаётся САМ хост, а не «1»: подтверждение должно
#: быть конкретным, иначе строка в профиле оболочки отключает защиту навсегда и
#: для любой базы.
_ALLOW_HOST = "E2E_SEED_ALLOW"

#: Чем опасен ИМЕННО этот сид на чужой базе. Текст уходит в каждый отказ: человек
#: на сервере читает сообщение, а не исходник.
_DANGER = (
    "Сид прогонов заводит врача с известным паролем и ИЗВЕСТНЫМ секретом\n"
    "второго фактора — на чужой базе это снимает второй фактор совсем, — а\n"
    "сквозной тест пишет назначение (отменить нельзя, prescriptions append-only)."
)


def _refuse_production(database_url: str) -> None:
    """Проверка адреса общая с демо-сидом (`core.tools.db_guard`).

    Своё здесь только описание опасности и имя переменной разрешения. Имена
    служб боевого compose разрешением НЕ открываются: на стенде этот сид не
    нужен вовсе.
    """
    refuse_foreign_database(
        database_url,
        allow_var=_ALLOW_HOST,
        danger=_DANGER,
        command="make seed-e2e",
    )


def _require_credentials_on_allowed_host() -> None:
    """Разрешил нелокальную базу — задай и пароль, и секрет второго фактора.

    Умолчания лежат в открытом репозитории. Опаснее здесь НЕ пароль: секрет
    второго фактора из репозитория означает, что второго фактора у врача нет
    вовсе — код к нему посчитает кто угодно.

    Проверяется не только «не умолчание», но и сила значения: `E2E_PASSWORD=x`
    прежде проходило насквозь, заводя врача с односимвольным паролем.

    Требование привязано к разрешению, а не ко всем запускам, и это не
    послабление, а условие работоспособности сторожа: ночной прогон
    (`.github/workflows/e2e.yml`) переменных не задаёт ВОВСЕ, а
    `apps/e2e/global-setup.ts` передаёт сиду ровно те значения, которые прогон
    взял у себя, — обе стороны сознательно сходятся на умолчаниях. Глухое
    требование убило бы единственную сквозную проверку кабинета.
    """
    if os.environ.get(_ALLOW_HOST, "").strip() == "":
        return
    # Сверяются ЗНАЧЕНИЯ, а не факт объявления: `apps/e2e/global-setup.ts`
    # передаёт сиду то, что взял у себя, а там при пустом окружении берётся то
    # же умолчание из репозитория. Проверка «переменная задана» такой запуск
    # пропустила бы, и текст отказа обещал бы больше, чем делает.
    missing = [
        name
        for name, value, default in (
            (_TOTP_VAR, _totp_secret(), _TOTP_DEFAULT),
            (_PASSWORD_VAR, _password(), _PASSWORD_DEFAULT),
        )
        if value == default
    ]
    if missing:
        raise SystemExit(
            f"База разрешена переменной {_ALLOW_HOST}, а осталось умолчание из\n"
            "репозитория: " + ", ".join(missing) + ".\n"
            f"Умолчания лежат в открытом репозитории. {_TOTP_VAR} важнее пароля:\n"
            "с известным секретом второго фактора у врача его попросту нет —\n"
            "код к нему посчитает кто угодно.\n"
            "Задайте обе переменные ТОЙ ЖЕ КОМАНДОЙ: сид читает окружение\n"
            "процесса, и запись в файле окружения он не увидит."
        )

    # Значение, отличное от умолчания, ещё не значит годное: `E2E_PASSWORD=x`
    # проходило проверку выше и заводило врача с известным секретом. Меряется
    # ДЛИНА, а не стойкость — двенадцать одинаковых букв её пройдут, как и у
    # демо-сида. Мер две, и они разной природы: пароль меряется общим минимумом
    # проекта, секрет второго фактора — стандартом (см. MIN_TOTP_CHARS).
    if len(_password()) < MIN_PASSWORD_LENGTH:
        raise SystemExit(
            f"{_PASSWORD_VAR} короче {MIN_PASSWORD_LENGTH} символов — на базе,\n"
            "которую видит не только ваша машина, это открытый кабинет врача.\n"
            "Минимум общий с демо-сидом: core.tools.db_guard."
        )

    secret = _totp_secret()
    # Длина последнего блока base32: восемь знаков кодируют пять байт, поэтому
    # остаток допустим не любой. Секрет в 27, 30 или 33 знака состоит из
    # разрешённых букв и длиннее минимума, но `pyotp` на нём падает
    # `Incorrect padding`, а прогон код считает — то самое расхождение сторон,
    # ради которого проверка алфавита и написана (ревью #202, третий заход).
    if len(secret) % 8 not in _BASE32_BLOCK_TAILS:
        raise SystemExit(
            f"{_TOTP_VAR} длиной {len(secret)} знаков не разбирается как base32:\n"
            "восемь знаков кодируют пять байт, и остаток бывает только 0, 2, 4,\n"
            "5 или 7. Сервер отвергнет такой секрет, а прогон — нет: вход\n"
            "упадёт «Неверный код подтверждения» без объяснимой причины."
        )

    if len(secret) < MIN_TOTP_CHARS:
        raise SystemExit(
            f"{_TOTP_VAR} короче {MIN_TOTP_CHARS} символов base32 — это меньше\n"
            "128 бит, нижней границы RFC 4226 §4. Короткий секрет второго\n"
            "фактора не лучше известного: код подбирается."
        )
    if set(secret.upper()) - _TOTP_ALPHABET:
        raise SystemExit(
            f"{_TOTP_VAR} содержит знаки вне base32 (A-Z, 2-7; регистр не\n"
            "важен). Разбор такого секрета падает на стороне и сервера, и\n"
            "прогона: вход упал бы «Неверный код подтверждения» без объяснимой\n"
            "причины. Знак равенства запрещён отдельно: прогон его срезает и\n"
            "код считает, а сервер на нём падает — расхождение сторон хуже\n"
            "отказа обеих."
        )


async def main() -> int:
    from api.security import hash_password

    database_url = get_settings().database_url
    _refuse_production(database_url)
    _require_credentials_on_allowed_host()
    engine = create_async_engine(database_url)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as session:
        doctor = await _user(session, UserRole.DOCTOR, "Врач Прогонов", DOCTOR_EMAIL, hash_password)
        parent = await _user(
            session, UserRole.PARENT, "Родитель Прогонов", PARENT_EMAIL, hash_password
        )

        # Секрет задаётся каждый раз, а не только при создании: он мог
        # смениться в прошлом прогоне или прийти другим из окружения, и тогда
        # вход упал бы без объяснения — тот же довод, что у пароля.
        doctor.totp_secret = _totp_secret()
        doctor.totp_pending_secret = None

        # А этому врачу второй фактор настраивает сам тест: проверка первичного
        # входа приглашённого специалиста иначе не делается нигде.
        doctor_setup = await _user(
            session, UserRole.DOCTOR, "Врач Настройки", DOCTOR_SETUP_EMAIL, hash_password
        )
        doctor_setup.totp_secret = None
        doctor_setup.totp_pending_secret = None
        # И резервные коды: тест получает их при настройке, а учётка обязана
        # возвращаться в исходное состояние целиком, а не наполовину. Именно
        # удаление: `replace_for_user` набор ВЫДАЁТ, а не стирает.
        await session.execute(
            delete(UserBackupCode).where(UserBackupCode.user_id == doctor_setup.id)
        )

        category = await _category(session)
        added = await _products(session, category_id=category.id, changed_by=doctor.id)
        patient = await _patient(session, parent=parent, doctor=doctor)

        await session.commit()
        patient_id = patient.id

    await engine.dispose()

    print(f"Пациент: {PATIENT_NAME} ({patient_id})")
    print(f"Продуктов добавлено: {added}")
    print(f"Врач:     {DOCTOR_EMAIL} (второй фактор задан)")
    print(f"Врач:     {DOCTOR_SETUP_EMAIL} (второй фактор не настроен)")
    print(f"Родитель: {PARENT_EMAIL}")
    return 0


async def _user(
    session: AsyncSession,
    role: UserRole,
    full_name: str,
    email: str,
    hash_password: Callable[[str], str],
) -> User:
    existing = await users_repo.get_by_email(session, email)
    if existing is not None:
        # Пароль переустанавливается: он мог смениться в прошлом прогоне или
        # прийти другим из окружения, и тогда вход упал бы без объяснения.
        existing.password_hash = hash_password(_password())
        existing.is_active = True
        return existing

    user = await users_repo.create(
        session,
        role=role,
        full_name=full_name,
        email=email,
        password_hash=hash_password(_password()),
    )
    return user


async def _category(session: AsyncSession) -> ProductCategory:
    category = await session.scalar(
        select(ProductCategory).where(ProductCategory.name_ru == "Прогонные")
    )
    if category is None:
        category = ProductCategory(name_ru="Прогонные", sort=200)
        session.add(category)
        await session.flush()
    return category


async def _products(session: AsyncSession, *, category_id: uuid.UUID, changed_by: uuid.UUID) -> int:
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


async def _patient(session: AsyncSession, *, parent: User, doctor: User) -> Patient:
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
