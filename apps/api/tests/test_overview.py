"""`/patients/{id}/overview` — сводка для главной (раздел 5.3 ТЗ, раздел 8.3 ТЗ).

Роутер ещё не подключён в `api.main` (это делает координатор), поэтому модуль
собирает приложение сам: фикстура `client` ниже перекрывает одноимённую из
conftest и добавляет роутер сводки.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps.auth import get_session
from api.main import create_app
from api.routers.overview import router as overview_router
from core.config import get_settings
from core.models import KetoneLog, Menu, SeizureLog, SeizureType, WeightLog
from core.models.enums import DiarySource, KetoneMethod, UserRole
from core.repositories import patients as patients_repo
from core.repositories import prescriptions as prescriptions_repo
from keto_engine import ENGINE_VERSION

pytestmark = pytest.mark.asyncio

# Тот же часовой пояс, что и у сервиса: сутки на главной — местные, не UTC.
TZ = ZoneInfo(get_settings().tz)

# Меню на 1240 ккал: жиры 120 г (1080 ккал) + белки 30 г и углеводы 10 г (160 ккал),
# соотношение 120 / (30 + 10) = 3.0. Против назначения 3.0 : 1 и 1200 ккал это
# попадание в допуски ядра (соотношение точное, отклонение по калорийности 3.3%).
TOTALS_ON_TARGET: dict[str, Any] = {
    "kcal": 1240.0,
    "fat": 120.0,
    "protein": 30.0,
    "carbs": 10.0,
    "fiber": 5.0,
    "ratio": 3.0,
}

# То же меню, но недокормленное: 700 ккал и соотношение 1.5 : 1 — мимо обоих допусков.
TOTALS_OFF_TARGET: dict[str, Any] = {
    "kcal": 700.0,
    "fat": 60.0,
    "protein": 30.0,
    "carbs": 10.0,
    "fiber": 5.0,
    "ratio": 1.5,
}


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()
    app.include_router(overview_router, prefix="/api/v1")

    async def _override_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _override_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


def _local_today() -> date:
    return datetime.now(TZ).date()


def _local_midnight() -> datetime:
    return datetime.combine(_local_today(), time.min, tzinfo=TZ)


async def _linked_parent(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


async def _prescription(session, *, patient, author, ratio: float = 3.0, kcal: int = 1200):
    return await prescriptions_repo.create(
        session,
        patient_id=patient.id,
        ratio=ratio,
        kcal_per_day=kcal,
        protein_g=30.0,
        carbs_limit_g=10.0,
        meals_per_day=4,
        author_id=author.id,
        effective_from=_local_today(),
    )


async def _menu(session, *, patient, day: date, totals: dict[str, Any] | None) -> Menu:
    menu = Menu(patient_id=patient.id, date=day, totals=totals, engine_version=ENGINE_VERSION)
    session.add(menu)
    await session.flush()
    return menu


async def _seizure_type(session) -> SeizureType:
    """Справочник наполняется сид-миграцией; в пустой базе создаём значение сами."""

    found = await session.scalar(select(SeizureType).order_by(SeizureType.sort).limit(1))
    if found is None:
        found = SeizureType(name_ru="Тонико-клонический", sort=0)
        session.add(found)
        await session.flush()
    return found


async def _seizure(session, *, patient, occurred_at: datetime, count: int = 1) -> SeizureLog:
    log = SeizureLog(
        patient_id=patient.id,
        occurred_at=occurred_at,
        source=DiarySource.WEB,
        seizure_type_id=(await _seizure_type(session)).id,
        count=count,
    )
    session.add(log)
    await session.flush()
    return log


async def _ketone(
    session, *, patient, occurred_at: datetime, value: float, method=KetoneMethod.BLOOD
) -> KetoneLog:
    log = KetoneLog(
        patient_id=patient.id,
        occurred_at=occurred_at,
        source=DiarySource.WEB,
        value=value,
        method=method,
    )
    session.add(log)
    await session.flush()
    return log


async def _weight(session, *, patient, occurred_at: datetime, weight_kg: float) -> WeightLog:
    log = WeightLog(
        patient_id=patient.id,
        occurred_at=occurred_at,
        source=DiarySource.WEB,
        weight_kg=weight_kg,
    )
    session.add(log)
    await session.flush()
    return log


class TestOverview:
    async def test_returns_whole_home_screen_in_one_request(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        await _prescription(session, patient=patient, author=doctor)
        await _menu(session, patient=patient, day=_local_today(), totals=TOTALS_ON_TARGET)
        await _ketone(
            session, patient=patient, occurred_at=_local_midnight() + timedelta(hours=8), value=2.5
        )
        await _weight(
            session,
            patient=patient,
            occurred_at=_local_midnight() + timedelta(hours=7),
            weight_kg=18.4,
        )
        await _seizure(session, patient=patient, occurred_at=_local_midnight() + timedelta(hours=9))

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert response.status_code == 200, response.text
        body = response.json()

        assert body["patient_id"] == str(patient.id)
        assert body["date"] == _local_today().isoformat()
        assert body["prescription"]["ratio"] == 3.0
        assert body["prescription"]["kcal_per_day"] == 1200
        assert body["day"]["totals"]["kcal"] == 1240.0
        assert body["day"]["totals"]["ratio"] == 3.0
        assert body["day"]["engine_version"] == ENGINE_VERSION
        assert body["last_ketone"]["value"] == 2.5
        assert body["last_ketone"]["method"] == "blood"
        assert body["last_weight"]["weight_kg"] == 18.4
        assert body["seizures_today"] == {"entries": 1, "count": 1}

    async def test_active_prescription_is_the_latest_version(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Активное назначение — последнее по created_at (раздел 4.2 ТЗ)."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        await _prescription(session, patient=patient, author=doctor, ratio=3.0, kcal=1200)
        await _prescription(session, patient=patient, author=doctor, ratio=4.0, kcal=1300)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert response.json()["prescription"]["ratio"] == 4.0

    async def test_totals_within_tolerance_flags(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        await _prescription(session, patient=patient, author=doctor)
        await _menu(session, patient=patient, day=_local_today(), totals=TOTALS_ON_TARGET)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert response.json()["day"]["tolerance"] == {
            "ratio_within_tolerance": True,
            "kcal_within_tolerance": True,
        }

    async def test_totals_outside_tolerance_flags(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        await _prescription(session, patient=patient, author=doctor)
        await _menu(session, patient=patient, day=_local_today(), totals=TOTALS_OFF_TARGET)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert response.json()["day"]["tolerance"] == {
            "ratio_within_tolerance": False,
            "kcal_within_tolerance": False,
        }

    async def test_no_prescription_leaves_tolerance_unknown(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Без назначения итоги дня не с чем сравнивать — не «всё в порядке», а null."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _menu(session, patient=patient, day=_local_today(), totals=TOTALS_ON_TARGET)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        body = response.json()
        assert body["prescription"] is None
        assert body["day"]["tolerance"] is None

    async def test_empty_patient_returns_nulls_not_error(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Семья, которая ещё ничего не вела: пустая главная — не ошибка."""

        parent, patient = await _linked_parent(session, make_user, make_patient)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert response.status_code == 200
        body = response.json()
        assert body["prescription"] is None
        assert body["day"] is None
        assert body["last_ketone"] is None
        assert body["last_weight"] is None
        assert body["seizures_today"] == {"entries": 0, "count": 0}

    async def test_menu_of_another_day_is_not_todays_summary(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _menu(
            session,
            patient=patient,
            day=_local_today() - timedelta(days=1),
            totals=TOTALS_ON_TARGET,
        )

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert response.json()["day"] is None

    async def test_menu_without_stored_totals_gives_no_day_summary(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Нули вместо несчитанных итогов утверждали бы, что ребёнок не ел."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _menu(session, patient=patient, day=_local_today(), totals=None)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert response.json()["day"] is None

    async def test_soft_deleted_menu_ignored(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        menu = await _menu(session, patient=patient, day=_local_today(), totals=TOTALS_ON_TARGET)
        menu.deleted_at = datetime.now(UTC)
        await session.flush()

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert response.json()["day"] is None


class TestLatestReadings:
    async def test_latest_ketone_and_weight_win(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        # Порядок вставки обратный хронологическому: сортировка идёт по occurred_at,
        # а не по порядку появления строк.
        await _ketone(
            session,
            patient=patient,
            occurred_at=_local_midnight() + timedelta(hours=9),
            value=3.1,
            method=KetoneMethod.URINE,
        )
        await _ketone(
            session,
            patient=patient,
            occurred_at=_local_midnight() - timedelta(days=2),
            value=1.2,
        )
        await _weight(
            session,
            patient=patient,
            occurred_at=_local_midnight() - timedelta(days=5),
            weight_kg=17.0,
        )
        await _weight(
            session,
            patient=patient,
            occurred_at=_local_midnight() - timedelta(days=1),
            weight_kg=18.9,
        )

        body = (
            await client.get(
                f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
            )
        ).json()

        assert body["last_ketone"]["value"] == 3.1
        assert body["last_ketone"]["method"] == "urine"
        assert body["last_weight"]["weight_kg"] == 18.9, (
            "последний вес — не обязательно сегодняшний"
        )

    async def test_soft_deleted_readings_ignored(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Удалённая запись не должна возвращаться как последнее измерение."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _ketone(
            session,
            patient=patient,
            occurred_at=_local_midnight() - timedelta(days=1),
            value=1.8,
        )
        deleted = await _ketone(
            session,
            patient=patient,
            occurred_at=_local_midnight() + timedelta(hours=6),
            value=9.9,
        )
        deleted.deleted_at = datetime.now(UTC)
        await session.flush()

        body = (
            await client.get(
                f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
            )
        ).json()
        assert body["last_ketone"]["value"] == 1.8

    async def test_readings_of_another_patient_not_shown(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        _, other_patient = await _linked_parent(session, make_user, make_patient)
        await _ketone(session, patient=other_patient, occurred_at=_local_midnight(), value=4.4)

        body = (
            await client.get(
                f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
            )
        ).json()
        assert body["last_ketone"] is None


class TestSeizuresToday:
    async def test_counted_by_local_day_not_utc(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Сутки берутся в `settings.tz`.

        Приступ в 00:30 по местному времени в UTC+5 приходится на предыдущую дату
        по UTC: при фильтре по UTC-дате он бы не попал в «сегодня», а семья
        увидела бы ноль приступов после бессонной ночи.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(
            session, patient=patient, occurred_at=_local_midnight() + timedelta(minutes=30)
        )
        await _seizure(
            session,
            patient=patient,
            occurred_at=_local_midnight() + timedelta(hours=23, minutes=30),
        )
        await _seizure(
            session, patient=patient, occurred_at=_local_midnight() - timedelta(minutes=30)
        )

        body = (
            await client.get(
                f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
            )
        ).json()
        assert body["seizures_today"] == {"entries": 2, "count": 2}

    async def test_sums_counts_of_series(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """В одной записи может быть отмечена серия приступов (`count`)."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(
            session, patient=patient, occurred_at=_local_midnight() + timedelta(hours=2), count=3
        )
        await _seizure(
            session, patient=patient, occurred_at=_local_midnight() + timedelta(hours=5), count=2
        )

        body = (
            await client.get(
                f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
            )
        ).json()
        assert body["seizures_today"] == {"entries": 2, "count": 5}

    async def test_soft_deleted_seizure_not_counted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        log = await _seizure(
            session, patient=patient, occurred_at=_local_midnight() + timedelta(hours=3), count=2
        )
        log.deleted_at = datetime.now(UTC)
        await session.flush()

        body = (
            await client.get(
                f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
            )
        ).json()
        assert body["seizures_today"] == {"entries": 0, "count": 0}


class TestAccessControl:
    async def test_other_patients_overview_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        other_child = await make_patient("Чужой")

        response = await client.get(
            f"/api/v1/patients/{other_child.id}/overview", headers=auth_headers(parent)
        )
        assert response.status_code == 403

    async def test_admin_has_no_access_to_clinical_data(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Правило 5 CLAUDE.md: админ к клиническим данным доступа не имеет."""

        admin = await make_user(UserRole.ADMIN)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=admin.id, patient_id=patient.id)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(admin)
        )
        assert response.status_code == 403

    async def test_attached_doctor_sees_overview(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(doctor)
        )
        assert response.status_code == 200

    async def test_anonymous_request_rejected(self, client, session, make_patient):
        patient = await make_patient()

        response = await client.get(f"/api/v1/patients/{patient.id}/overview")
        assert response.status_code == 401

    async def test_unknown_patient_forbidden(self, client, make_user, auth_headers):
        """Несуществующий пациент отдаётся как 403, а не 404: иначе по коду ответа
        можно перебором узнать, какие идентификаторы существуют."""

        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            f"/api/v1/patients/{uuid.uuid4()}/overview", headers=auth_headers(parent)
        )
        assert response.status_code == 403

    async def test_invalid_patient_id_rejected(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/patients/not-a-uuid/overview", headers=auth_headers(parent)
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
