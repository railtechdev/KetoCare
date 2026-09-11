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
from api.services.monitoring import add_months
from api.services.overview import _TREND_WINDOW_DAYS
from core.config import get_settings
from core.models import KetoneLog, Menu, SeizureLog, SeizureType, WeightLog
from core.models.enums import DiarySource, KetoneMethod, UserRole
from core.repositories import medical_profiles as medical_profiles_repo
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


async def _menu(
    session,
    *,
    patient,
    day: date,
    totals: dict[str, Any] | None,
    engine_version: str | None = ENGINE_VERSION,
) -> Menu:
    menu = Menu(patient_id=patient.id, date=day, totals=totals, engine_version=engine_version)
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
        body = response.json()
        assert body["day"]["tolerance"] == {
            "ratio_within_tolerance": True,
            "kcal_within_tolerance": True,
        }
        # Причина и вердикт исключают друг друга: иначе экран однажды покажет и
        # вердикт, и объяснение, почему его нет.
        assert body["day"]["tolerance_gap"] is None

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
        # Причина названа: без неё экран объяснял бы отсутствие вердикта
        # единственным текстом, и второй случай (смена версии ядра) читался бы
        # как «назначения нет».
        assert body["day"]["tolerance_gap"] == "no_prescription"

    async def test_day_of_another_engine_major_gets_no_verdict(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """День, посчитанный прежним ядром, вердикта не получает.

        Итоги дня хранятся снимком и не пересчитываются, а смена основной версии
        означает, что изменились сами числа: с 1.0.0 соотношение считается по
        чистым углеводам (ADR-0030). «В допуске» про соотношение, посчитанное
        прежним правилом, — старое утверждение, выданное за сегодняшнее.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _prescription(session, patient=patient, author=parent)
        await _menu(
            session,
            patient=patient,
            day=_local_today(),
            totals=TOTALS_ON_TARGET,
            engine_version="0.4.0",
        )

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        body = response.json()
        # Сами числа дня показываются — исчезает только вердикт о них.
        assert body["day"]["totals"]["ratio"] is not None
        assert body["day"]["engine_version"] == "0.4.0"
        assert body["day"]["tolerance"] is None
        # Назначение у ребёнка есть, и причина обязана это отражать: «нет
        # назначения» здесь было бы прямой неправдой семье.
        assert body["day"]["tolerance_gap"] == "engine_changed"
        assert body["prescription"] is not None

    async def test_minor_bump_keeps_the_verdict(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Разошлись только minor и patch — вердикт остаётся.

        Молчание стоит на смене ОСНОВНОЙ версии: она означает, что изменились
        сами числа. Minor чисел не меняет (0.3.0 → 0.4.0 добавила вклад позиций
        и не тронула итоги), и снимать по нему вердикт со всех сохранённых дней
        значило бы наказывать семью за безобидный выпуск.

        Без этого случая сравнение версии целиком проходило бы все тесты.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _prescription(session, patient=patient, author=parent)
        major = ENGINE_VERSION.split(".", 1)[0]
        await _menu(
            session,
            patient=patient,
            day=_local_today(),
            totals=TOTALS_ON_TARGET,
            engine_version=f"{major}.99.99",
        )

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        body = response.json()
        assert body["day"]["tolerance"] is not None
        assert body["day"]["tolerance_gap"] is None

    async def test_day_without_engine_version_does_not_claim_a_previous_one(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Версия не записана — так и говорим, а не «посчитан прежней».

        Колонка допускает пустое значение. Сверять с ним нечего, но назвать
        такой день посчитанным прежней версией — утверждение о том, чего мы не
        знаем: какой именно версией, неизвестно.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _prescription(session, patient=patient, author=parent)
        await _menu(
            session,
            patient=patient,
            day=_local_today(),
            totals=TOTALS_ON_TARGET,
            engine_version=None,
        )

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        body = response.json()
        assert body["day"]["tolerance"] is None
        assert body["day"]["tolerance_gap"] == "engine_unknown"

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


class TestSeizureTrend:
    """Приступов стало больше — врач должен увидеть это в списке пациентов.

    Ответ клиники 09.09.2026 (вопрос 12): считать по СУММАРНОМУ числу приступов,
    порог — более 50 %. Не по числу записей: одна запись описывает серию, и
    подменять одно другим значит занижать картину.
    """

    @staticmethod
    def _at(days_ago: int) -> datetime:
        """Полдень местных суток `days_ago` дней назад — заведомо внутри дня."""

        return datetime.combine(_local_today() - timedelta(days=days_ago), time(12), tzinfo=TZ)

    async def test_growth_over_half_raises_the_flag(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        # Прошлая неделя: 4 приступа. Эта: 7 — рост на 75 %.
        await _seizure(session, patient=patient, occurred_at=self._at(10), count=4)
        await _seizure(session, patient=patient, occurred_at=self._at(3), count=7)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend == {"recent": 7, "previous": 4, "grew": True, "appeared": False}

    async def test_exactly_half_is_not_growth(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """«Более 50 %» — строго больше. Ровно +50 % флага не даёт.

        Граница названа клиникой словами, и сдвинуть её на «не меньше» значит
        поменять медицинское правило молча.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(session, patient=patient, occurred_at=self._at(10), count=4)
        await _seizure(session, patient=patient, occurred_at=self._at(3), count=6)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend["recent"] == 6
        assert trend["previous"] == 4
        assert trend["grew"] is False

    async def test_counts_seizures_not_entries(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Одна запись «5 абсансов за утро» — это пять приступов, а не один.

        Без этого случая правило проходило бы и на числе записей: там 1 против
        1, то есть роста нет вовсе.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(session, patient=patient, occurred_at=self._at(10), count=1)
        await _seizure(session, patient=patient, occurred_at=self._at(3), count=5)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend["recent"] == 5
        assert trend["previous"] == 1
        assert trend["grew"] is True

    async def test_appearing_after_a_clean_week_is_not_a_percentage(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Неделя без приступов — сравнивать не с чем.

        Любой приступ дал бы рост «на бесконечность», а порога для этого случая
        клиника не задавала. Поэтому `grew` пуст, а факт отдаётся отдельным
        полем: выдумать процент — значит выдумать медицинское правило.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(session, patient=patient, occurred_at=self._at(2), count=3)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend == {"recent": 3, "previous": 0, "grew": None, "appeared": True}

    async def test_two_clean_weeks_raise_nothing(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend == {"recent": 0, "previous": 0, "grew": None, "appeared": False}

    async def test_older_seizures_do_not_leak_into_the_window(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Окно ровно две недели: приступ пятнадцатидневной давности не считается.

        Иначе «предыдущая неделя» растягивалась бы в прошлое и рост размывался.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(session, patient=patient, occurred_at=self._at(15), count=9)
        await _seizure(session, patient=patient, occurred_at=self._at(2), count=1)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend["previous"] == 0, "приступ за пределами окна попал в сравнение"
        assert trend["recent"] == 1

    async def test_the_seam_between_the_weeks_is_exactly_one_day_wide(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Шов между неделями: шестые сутки — эта неделя, седьмые — прошлая.

        Остальные случаи ставят приступы на 2, 3, 10 и 15 суток назад, то есть
        глубоко внутрь окон и далеко за них, и мимо шва проходят. А живёт
        off-by-one именно здесь, и стоит он дорого: сдвинь начало недели на
        сутки — окна перекроются, приступы шовного дня посчитаются ОБЕИМ
        неделям, и у ребёнка с 2 приступами в тот понедельник и 3 за остальные
        дни выйдет 5 против 2 вместо 3 против 2. То есть красная пометка
        «Приступов стало больше» у того, у кого их стало меньше.

        Проверяется и попадание, и непопадание: без второй половины окно можно
        было бы расширить в прошлое, без первой — сузить.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(session, patient=patient, occurred_at=self._at(6), count=3)
        await _seizure(session, patient=patient, occurred_at=self._at(7), count=2)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend["recent"] == 3, "шестые сутки назад — это ещё последняя неделя"
        assert trend["previous"] == 2, "седьмые сутки назад — это уже предыдущая"
        # 3 против 2 — рост на 50 %, то есть НЕ «более 50 %». Если окна
        # перекрылись, `recent` станет 5 и флаг загорится.
        assert trend["grew"] is False

    async def test_today_counts_in_both_today_and_the_week(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Сегодняшний приступ виден и в «за сегодня», и в «за неделю».

        Три окна сводки считаются одним запросом (`count_seizures_by_window`), и
        «сегодня» целиком лежит внутри последней недели. Считай их окна
        зависимыми — приступ попал бы ровно в одно, и врач видел бы либо ноль за
        сегодня у ребёнка с приступом час назад, либо неделю без него.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(session, patient=patient, occurred_at=self._at(0), count=2)
        await _seizure(session, patient=patient, occurred_at=self._at(4), count=1)
        await _seizure(session, patient=patient, occurred_at=self._at(9), count=6)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        body = response.json()

        assert body["seizures_today"] == {"entries": 1, "count": 2}
        assert body["seizure_trend"]["recent"] == 3
        assert body["seizure_trend"]["previous"] == 6

    async def test_deleted_entries_are_not_counted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Мягко удалённая запись не участвует ни в одном окне.

        Семья исправляет ошибочную запись удалением (правило 4: физически
        строки не пропадают), и посчитанная удалённая серия дала бы врачу
        красную пометку по записи, которой уже нет.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(session, patient=patient, occurred_at=self._at(10), count=4)
        await _seizure(session, patient=patient, occurred_at=self._at(3), count=5)
        removed = await _seizure(session, patient=patient, occurred_at=self._at(3), count=9)
        removed.deleted_at = self._at(1)
        await session.flush()

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend["recent"] == 5, "удалённая запись попала в счёт"
        assert trend["previous"] == 4
        # Посчитай удалённую девятку — вышло бы 14 против 4, то есть красная
        # пометка «Приступов стало больше» по записи, которой уже нет.
        assert trend["grew"] is False

    async def test_midnight_belongs_to_one_week_only(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Приступ ровно в полночь принадлежит наступившим суткам, а не обоим.

        Интервалы полуоткрытые — `[from, to)`, — и это обещано докстрокой
        репозитория, но остальные случаи ставят приступы в полдень и мига
        полуночи не касаются. Мутация `<` → `<=` на верхней границе проходила
        все проверки, а на данных давала двойной счёт: запись в 00:00 шовного
        дня попадала и в последнюю неделю, и в предыдущую.

        Полночь достижима руками: в дневнике время вводится `datetime-local` с
        точностью до минуты, и ночной приступ «в 00:00» — обычная запись.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        midnight_of_seam = datetime.combine(
            _local_today() - timedelta(days=_TREND_WINDOW_DAYS - 1), time.min, tzinfo=TZ
        )
        # Полночь шестых суток назад — первый миг последней недели.
        await _seizure(session, patient=patient, occurred_at=midnight_of_seam, count=4)
        # Последний миг предыдущей недели: на микросекунду раньше.
        await _seizure(
            session,
            patient=patient,
            occurred_at=midnight_of_seam - timedelta(microseconds=1),
            count=1,
        )

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend["recent"] == 4, "полночь принадлежит наступившим суткам"
        assert trend["previous"] == 1, "последний миг прошлой недели остался в ней"

    async def test_growth_just_over_the_threshold_raises_the_flag(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """+60 % — уже рост. Случай прижимает порог сверху.

        Без него порог держался только снизу (`test_exactly_half_is_not_growth`)
        и парой 4 → 7, а это +75 %: любое значение от 1.5 до 1.75 проходило все
        проверки. То есть «более 50 %» можно было бы незаметно превратить в
        «более 70 %».
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _seizure(session, patient=patient, occurred_at=self._at(10), count=10)
        await _seizure(session, patient=patient, occurred_at=self._at(3), count=16)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        trend = response.json()["seizure_trend"]

        assert trend == {"recent": 16, "previous": 10, "grew": True, "appeared": False}


class TestMonitoringPhase:
    """Первый месяц терапии — строгое наблюдение (ответ клиники на вопрос 11).

    Сводка отдаёт РЕЖИМ, а кабинет по нему выбирает порог молчания семьи. Режим
    считается от даты начала терапии: слова врача, иначе первого назначения.
    """

    @staticmethod
    async def _prescribed(session, make_user, patient, *, on: date):
        doctor = await make_user(UserRole.DOCTOR)
        return await prescriptions_repo.create(
            session,
            patient_id=patient.id,
            ratio=3.0,
            kcal_per_day=1200,
            protein_g=30.0,
            carbs_limit_g=10.0,
            meals_per_day=4,
            author_id=doctor.id,
            effective_from=on,
        )

    async def _phase(self, client, patient, parent, auth_headers) -> dict[str, Any]:
        response = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body

    async def test_first_month_after_the_first_prescription_is_strict(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        await self._prescribed(session, make_user, patient, on=_local_today())

        body = await self._phase(client, patient, parent, auth_headers)

        assert body["monitoring_phase"] == "strict"

    async def test_after_the_first_month_it_is_routine(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Ровно месяц назад — уже обычный контроль: день, в который месяц
        истекает, строгим не считается."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await self._prescribed(session, make_user, patient, on=add_months(_local_today(), -1))

        body = await self._phase(client, patient, parent, auth_headers)

        assert body["monitoring_phase"] == "routine"

    async def test_without_therapy_there_is_nothing_to_monitor(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)

        body = await self._phase(client, patient, parent, auth_headers)

        assert body["monitoring_phase"] == "before_start"

    async def test_the_doctors_start_date_decides_the_month(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Назначение полугодовой давности, но врач назвал началом сегодня.

        Так бывает, когда назначение записали заранее, а диету начали позже:
        клиника сказала «от начала диеты», и начало диеты — это то, что указал
        врач (ответ 17), а не дата первой строки назначений.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await self._prescribed(session, make_user, patient, on=_local_today() - timedelta(days=180))
        await medical_profiles_repo.upsert(
            session,
            patient_id=patient.id,
            diagnosis=None,
            epilepsy_type=None,
            onset_age_months=None,
            genetics=None,
            comorbidities=None,
            therapy_started_on=_local_today(),
        )

        body = await self._phase(client, patient, parent, auth_headers)

        assert body["monitoring_phase"] == "strict"

    async def test_the_start_date_itself_does_not_reach_the_family(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """В сводку уходит режим, а не дата.

        Сводка общая для семьи и врача, а дата начала терапии лежит в
        медицинском профиле, который семье закрыт. Положи её сюда — и доступ
        расширился бы молча, мимо проверки ролей у `/medical-profile`.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await medical_profiles_repo.upsert(
            session,
            patient_id=patient.id,
            diagnosis=None,
            epilepsy_type=None,
            onset_age_months=None,
            genetics=None,
            comorbidities=None,
            therapy_started_on=date(2026, 3, 15),
        )

        body = await self._phase(client, patient, parent, auth_headers)

        assert "therapy_started_on" not in str(body)
        assert "2026-03-15" not in str(body)
