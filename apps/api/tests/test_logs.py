"""`/patients/{id}/logs/{kind}` — дневники (раздел 5.3 ТЗ).

Роутер ещё не подключён в `api.main` (это делает координатор), поэтому модуль
собирает приложение сам: фикстура `client` ниже перекрывает одноимённую из
conftest и добавляет роутер дневников.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps.auth import get_session
from api.main import create_app
from api.routers.logs import router as logs_router
from core.models import KetoneLog, Medication, Menu, MenuItem, SeizureLog, SeizureType
from core.models.enums import MealSlot, UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

KINDS = ["seizures", "ketones", "weight", "medications", "meals", "side-effects"]

OCCURRED_AT = datetime(2026, 8, 1, 9, 0, tzinfo=UTC)


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()
    app.include_router(logs_router, prefix="/api/v1")

    async def _override_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _override_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


async def _linked_parent(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


async def _seizure_type(session) -> SeizureType:
    """Справочник наполняется сид-миграцией; в пустой базе создаём значение сами."""

    found = await session.scalar(select(SeizureType).order_by(SeizureType.sort).limit(1))
    if found is None:
        found = SeizureType(name_ru="Тонико-клонический", sort=0)
        session.add(found)
        await session.flush()
    return found


async def _medication(session, *, patient, author) -> Medication:
    medication = Medication(
        patient_id=patient.id,
        drug_name="Депакин",
        dose="200 мг",
        frequency="2 раза в день",
        started_at=date(2026, 1, 1),
        author_id=author.id,
    )
    session.add(medication)
    await session.flush()
    return medication


async def _menu_item(session, *, patient) -> MenuItem:
    menu = Menu(patient_id=patient.id, date=date(2026, 8, 1))
    session.add(menu)
    await session.flush()
    item = MenuItem(menu_id=menu.id, patient_id=patient.id, meal_slot=MealSlot.BREAKFAST)
    session.add(item)
    await session.flush()
    return item


async def _payload(session, kind: str, *, patient, author, occurred_at=OCCURRED_AT) -> dict:
    """Минимальное валидное тело запроса для каждого вида записи."""

    base = {"occurred_at": occurred_at.isoformat()}
    match kind:
        case "seizures":
            seizure_type = await _seizure_type(session)
            return base | {"seizure_type_id": str(seizure_type.id), "count": 2}
        case "ketones":
            return base | {"value": 2.5, "method": "blood"}
        case "weight":
            return base | {"weight_kg": 18.4}
        case "medications":
            medication = await _medication(session, patient=patient, author=author)
            return base | {"medication_id": str(medication.id), "taken": True}
        case "meals":
            return base | {"free_text": "Омлет на сливочном масле"}
        case "side-effects":
            return base | {"symptom": "Тошнота"}
    raise AssertionError(f"неизвестный вид записи: {kind}")


def _url(patient_id, kind: str) -> str:
    return f"/api/v1/patients/{patient_id}/logs/{kind}"


class TestCreate:
    @pytest.mark.parametrize("kind", KINDS)
    async def test_creates_record_of_every_kind(
        self, client, session, make_user, make_patient, auth_headers, kind
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        payload = await _payload(session, kind, patient=patient, author=doctor)

        response = await client.post(
            _url(patient.id, kind), json=payload, headers=auth_headers(parent)
        )
        assert response.status_code == 201, response.text
        body = response.json()

        assert body["patient_id"] == str(patient.id)
        assert datetime.fromisoformat(body["occurred_at"]) == OCCURRED_AT
        assert body["source"] == "web", "канал проставляет сервер по ручке (раздел 5.3 ТЗ)"
        assert body["created_by"] == str(parent.id)

    @pytest.mark.parametrize("kind", KINDS)
    async def test_client_cannot_set_source_or_author(
        self, client, session, make_user, make_patient, auth_headers, kind
    ):
        """Иначе запись из веба могла бы объявить себя разбором ИИ или чужим авторством."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        payload = await _payload(session, kind, patient=patient, author=doctor)

        response = await client.post(
            _url(patient.id, kind),
            json=payload | {"source": "ai_parsed", "created_by": str(doctor.id)},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_naive_occurred_at_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Без смещения момент неоднозначен: 09:00 в Ташкенте и в UTC — разница
        в пять часов, а по occurred_at строится вся динамика в отчётах."""

        parent, patient = await _linked_parent(session, make_user, make_patient)

        response = await client.post(
            _url(patient.id, "ketones"),
            json={"occurred_at": "2026-08-01T09:00:00", "value": 2.5, "method": "blood"},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422


class TestValidation:
    @pytest.mark.parametrize("value", [-0.1, 12.1, 100])
    async def test_ketones_outside_range_rejected(
        self, client, session, make_user, make_patient, auth_headers, value
    ):
        """Раздел 7.3 ТЗ: кетоны 0-12 ммоль/л."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            _url(patient.id, "ketones"),
            json={"occurred_at": OCCURRED_AT.isoformat(), "value": value, "method": "blood"},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    @pytest.mark.parametrize("value", [0, 12])
    async def test_ketones_range_bounds_accepted(
        self, client, session, make_user, make_patient, auth_headers, value
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            _url(patient.id, "ketones"),
            json={"occurred_at": OCCURRED_AT.isoformat(), "value": value, "method": "urine"},
            headers=auth_headers(parent),
        )
        assert response.status_code == 201, response.text

    @pytest.mark.parametrize("weight", [1.9, 150.1])
    async def test_weight_outside_range_rejected(
        self, client, session, make_user, make_patient, auth_headers, weight
    ):
        """Раздел 7.3 ТЗ: вес 2-150 кг."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            _url(patient.id, "weight"),
            json={"occurred_at": OCCURRED_AT.isoformat(), "weight_kg": weight},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "extra",
        [
            {"count": 0},
            {"duration_sec": -1},
            {"description": "х" * 2001},
        ],
    )
    async def test_seizure_field_bounds(
        self, client, session, make_user, make_patient, auth_headers, extra
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        seizure_type = await _seizure_type(session)

        response = await client.post(
            _url(patient.id, "seizures"),
            json={
                "occurred_at": OCCURRED_AT.isoformat(),
                "seizure_type_id": str(seizure_type.id),
                **extra,
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_empty_symptom_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            _url(patient.id, "side-effects"),
            json={"occurred_at": OCCURRED_AT.isoformat(), "symptom": ""},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_meal_without_content_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Приём пищи без позиции меню и без текста в дневнике — пустая строка."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            _url(patient.id, "meals"),
            json={"occurred_at": OCCURRED_AT.isoformat()},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422
        assert "меню" in response.json()["error"]["message"]

    async def test_parsed_is_not_client_writable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """`parsed` — результат AI-разбора (раздел 5.4 ТЗ), его пишет сценарий
        подтверждения, а не клиент напрямую."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            _url(patient.id, "meals"),
            json={
                "occurred_at": OCCURRED_AT.isoformat(),
                "free_text": "Омлет",
                "parsed": {"kcal": 1},
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422


class TestReferences:
    async def test_unknown_seizure_type_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            _url(patient.id, "seizures"),
            json={
                "occurred_at": OCCURRED_AT.isoformat(),
                "seizure_type_id": str(uuid.uuid4()),
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_medication_of_another_patient_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Иначе в дневнике ребёнка оказался бы препарат чужого назначения."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        _, other_patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        foreign = await _medication(session, patient=other_patient, author=doctor)

        response = await client.post(
            _url(patient.id, "medications"),
            json={
                "occurred_at": OCCURRED_AT.isoformat(),
                "medication_id": str(foreign.id),
                "taken": True,
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_unknown_medication_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            _url(patient.id, "medications"),
            json={
                "occurred_at": OCCURRED_AT.isoformat(),
                "medication_id": str(uuid.uuid4()),
                "taken": False,
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_menu_item_of_another_patient_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        _, other_patient = await _linked_parent(session, make_user, make_patient)
        foreign_item = await _menu_item(session, patient=other_patient)

        response = await client.post(
            _url(patient.id, "meals"),
            json={"occurred_at": OCCURRED_AT.isoformat(), "menu_item_id": str(foreign_item.id)},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_own_menu_item_accepted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        item = await _menu_item(session, patient=patient)

        response = await client.post(
            _url(patient.id, "meals"),
            json={"occurred_at": OCCURRED_AT.isoformat(), "menu_item_id": str(item.id)},
            headers=auth_headers(parent),
        )
        assert response.status_code == 201, response.text
        assert response.json()["menu_item_id"] == str(item.id)
        assert response.json()["parsed"] is None


class TestAccessControl:
    @pytest.mark.parametrize("kind", KINDS)
    async def test_logs_of_other_patient_forbidden(
        self, client, session, make_user, make_patient, auth_headers, kind
    ):
        parent = await make_user(UserRole.PARENT)
        other_child = await make_patient("Чужой")

        response = await client.get(_url(other_child.id, kind), headers=auth_headers(parent))
        assert response.status_code == 403

    async def test_admin_has_no_access_to_diary(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Раздел 5.1 ТЗ: админ к клиническим данным доступа не имеет."""

        admin = await make_user(UserRole.ADMIN)
        patient = await make_patient()

        response = await client.get(_url(patient.id, "ketones"), headers=auth_headers(admin))
        assert response.status_code == 403

    async def test_unauthenticated_rejected(self, client, session, make_patient):
        patient = await make_patient()
        response = await client.get(_url(patient.id, "ketones"))
        assert response.status_code == 401

    @pytest.mark.parametrize("method", ["patch", "delete"])
    async def test_record_of_another_patient_not_reachable(
        self, client, session, make_user, make_patient, auth_headers, method
    ):
        """Доступ к пациенту не даёт прав на запись другого — и это 404, а не 403:
        иначе по коду ответа видно, что запись существует."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        other_parent, other_patient = await _linked_parent(session, make_user, make_patient)

        created = await client.post(
            _url(other_patient.id, "ketones"),
            json={"occurred_at": OCCURRED_AT.isoformat(), "value": 3.0, "method": "blood"},
            headers=auth_headers(other_parent),
        )
        log_id = created.json()["id"]

        url = f"{_url(patient.id, 'ketones')}/{log_id}"
        if method == "patch":
            response = await client.patch(url, json={"value": 1.0}, headers=auth_headers(parent))
        else:
            response = await client.delete(url, headers=auth_headers(parent))
        assert response.status_code == 404


class TestList:
    async def test_filters_by_period_and_sorts_desc(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        url = _url(patient.id, "ketones")
        headers = auth_headers(parent)

        moments = [OCCURRED_AT + timedelta(days=offset) for offset in (0, 1, 2)]
        for index, moment in enumerate(moments):
            created = await client.post(
                url,
                json={"occurred_at": moment.isoformat(), "value": index, "method": "blood"},
                headers=headers,
            )
            assert created.status_code == 201, created.text

        listing = await client.get(url, headers=headers)
        assert listing.status_code == 200
        occurred = [item["occurred_at"] for item in listing.json()["items"]]
        assert occurred == [m.isoformat().replace("+00:00", "Z") for m in reversed(moments)]

        window = await client.get(
            url,
            params={"from": moments[1].isoformat(), "to": moments[1].isoformat()},
            headers=headers,
        )
        assert window.json()["total"] == 1
        assert window.json()["items"][0]["value"] == 1.0

    async def test_pagination(self, client, session, make_user, make_patient, auth_headers):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        url = _url(patient.id, "weight")
        headers = auth_headers(parent)

        for offset in range(3):
            await client.post(
                url,
                json={
                    "occurred_at": (OCCURRED_AT + timedelta(days=offset)).isoformat(),
                    "weight_kg": 18 + offset,
                },
                headers=headers,
            )

        page = await client.get(url, params={"limit": 2, "offset": 1}, headers=headers)
        body = page.json()
        assert body["total"] == 3, "total считает все записи периода, а не страницу"
        assert len(body["items"]) == 2
        assert body["items"][0]["weight_kg"] == 19.0

    async def test_reversed_period_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.get(
            _url(patient.id, "ketones"),
            params={
                "from": (OCCURRED_AT + timedelta(days=1)).isoformat(),
                "to": OCCURRED_AT.isoformat(),
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_shows_only_own_patient_records(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        other_parent, other_patient = await _linked_parent(session, make_user, make_patient)

        await client.post(
            _url(other_patient.id, "ketones"),
            json={"occurred_at": OCCURRED_AT.isoformat(), "value": 4.0, "method": "blood"},
            headers=auth_headers(other_parent),
        )

        listing = await client.get(_url(patient.id, "ketones"), headers=auth_headers(parent))
        assert listing.json()["total"] == 0


class TestUpdate:
    async def test_partial_update_keeps_other_fields(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        url = _url(patient.id, "ketones")
        headers = auth_headers(parent)

        created = await client.post(
            url,
            json={"occurred_at": OCCURRED_AT.isoformat(), "value": 2.5, "method": "blood"},
            headers=headers,
        )
        log_id = created.json()["id"]

        updated = await client.patch(f"{url}/{log_id}", json={"value": 3.1}, headers=headers)
        assert updated.status_code == 200, updated.text
        body = updated.json()
        assert body["value"] == 3.1
        assert body["method"] == "blood", "не переданное поле остаётся прежним"
        assert datetime.fromisoformat(body["occurred_at"]) == OCCURRED_AT
        assert body["source"] == "web"

    async def test_null_clears_optional_field(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        seizure_type = await _seizure_type(session)
        url = _url(patient.id, "seizures")
        headers = auth_headers(parent)

        created = await client.post(
            url,
            json={
                "occurred_at": OCCURRED_AT.isoformat(),
                "seizure_type_id": str(seizure_type.id),
                "description": "во сне",
            },
            headers=headers,
        )
        log_id = created.json()["id"]

        updated = await client.patch(f"{url}/{log_id}", json={"description": None}, headers=headers)
        assert updated.status_code == 200, updated.text
        assert updated.json()["description"] is None

    async def test_null_for_required_field_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Иначе NOT NULL-ограничение БД дало бы 500 вместо понятной ошибки."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        url = _url(patient.id, "ketones")
        headers = auth_headers(parent)

        created = await client.post(
            url,
            json={"occurred_at": OCCURRED_AT.isoformat(), "value": 2.5, "method": "blood"},
            headers=headers,
        )
        log_id = created.json()["id"]

        response = await client.patch(f"{url}/{log_id}", json={"value": None}, headers=headers)
        assert response.status_code == 422

        row = await session.get(KetoneLog, uuid.UUID(log_id))
        assert float(row.value) == 2.5

    async def test_out_of_range_value_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        url = _url(patient.id, "ketones")
        headers = auth_headers(parent)

        created = await client.post(
            url,
            json={"occurred_at": OCCURRED_AT.isoformat(), "value": 2.5, "method": "blood"},
            headers=headers,
        )
        log_id = created.json()["id"]

        response = await client.patch(f"{url}/{log_id}", json={"value": 15}, headers=headers)
        assert response.status_code == 422

    async def test_meal_cannot_be_emptied(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Проверка «есть содержимое» учитывает и уже сохранённые поля, а не только тело PATCH."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        url = _url(patient.id, "meals")
        headers = auth_headers(parent)

        created = await client.post(
            url,
            json={"occurred_at": OCCURRED_AT.isoformat(), "free_text": "Омлет"},
            headers=headers,
        )
        log_id = created.json()["id"]

        response = await client.patch(f"{url}/{log_id}", json={"free_text": None}, headers=headers)
        assert response.status_code == 422

    async def test_reference_checked_on_update(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        _, other_patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        own = await _medication(session, patient=patient, author=doctor)
        foreign = await _medication(session, patient=other_patient, author=doctor)

        url = _url(patient.id, "medications")
        headers = auth_headers(parent)
        created = await client.post(
            url,
            json={
                "occurred_at": OCCURRED_AT.isoformat(),
                "medication_id": str(own.id),
                "taken": True,
            },
            headers=headers,
        )
        log_id = created.json()["id"]

        response = await client.patch(
            f"{url}/{log_id}", json={"medication_id": str(foreign.id)}, headers=headers
        )
        assert response.status_code == 422


class TestDelete:
    @pytest.mark.parametrize("kind", KINDS)
    async def test_delete_is_soft(
        self, client, session, make_user, make_patient, auth_headers, kind
    ):
        """Правило 4 CLAUDE.md: дневниковые записи физически не удаляются."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        url = _url(patient.id, kind)
        headers = auth_headers(parent)

        payload = await _payload(session, kind, patient=patient, author=doctor)
        created = await client.post(url, json=payload, headers=headers)
        log_id = created.json()["id"]

        deleted = await client.delete(f"{url}/{log_id}", headers=headers)
        assert deleted.status_code == 204

        listing = await client.get(url, headers=headers)
        assert listing.json()["total"] == 0, "удалённая запись не показывается"

    async def test_row_stays_in_database(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        seizure_type = await _seizure_type(session)
        url = _url(patient.id, "seizures")
        headers = auth_headers(parent)

        created = await client.post(
            url,
            json={
                "occurred_at": OCCURRED_AT.isoformat(),
                "seizure_type_id": str(seizure_type.id),
            },
            headers=headers,
        )
        log_id = created.json()["id"]
        await client.delete(f"{url}/{log_id}", headers=headers)

        row = await session.scalar(select(SeizureLog).where(SeizureLog.id == uuid.UUID(log_id)))
        assert row is not None, "строка остаётся в БД"
        assert row.deleted_at is not None

    async def test_deleted_record_not_editable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        url = _url(patient.id, "ketones")
        headers = auth_headers(parent)

        created = await client.post(
            url,
            json={"occurred_at": OCCURRED_AT.isoformat(), "value": 2.5, "method": "blood"},
            headers=headers,
        )
        log_id = created.json()["id"]
        await client.delete(f"{url}/{log_id}", headers=headers)

        assert (await client.delete(f"{url}/{log_id}", headers=headers)).status_code == 404
        patched = await client.patch(f"{url}/{log_id}", json={"value": 1.0}, headers=headers)
        assert patched.status_code == 404
