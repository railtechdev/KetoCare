"""`/admin` — учётные записи, справочники, журнал аудита (раздел 5.3 ТЗ).

Роутер ещё не подключён в `create_app()`, поэтому фикстура `client` собирает
приложение и добавляет его сама.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps.auth import get_session
from api.main import create_app
from api.routers.admin import router as admin_router
from core.models import AuditLog, KetoneMethodDict, SeizureLog, SeizureType, User
from core.models.enums import DiarySource, UserRole
from core.repositories import audit as audit_repo

pytestmark = pytest.mark.asyncio

USERS_URL = "/api/v1/admin/users"
AUDIT_URL = "/api/v1/admin/audit-log"
SEIZURE_TYPES_URL = "/api/v1/admin/dictionaries/seizure-types"
KETONE_METHODS_URL = "/api/v1/admin/dictionaries/ketone-methods"

NON_ADMIN_ROLES = [UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.PARENT]


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()
    app.include_router(admin_router, prefix="/api/v1")

    async def _override_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _override_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


async def _audit_entries(session: AsyncSession, *, entity: str) -> list[AuditLog]:
    rows = await session.scalars(
        select(AuditLog).where(AuditLog.entity == entity).order_by(AuditLog.created_at.desc())
    )
    return list(rows)


class TestAccessControl:
    @pytest.mark.parametrize("url", [USERS_URL, AUDIT_URL, SEIZURE_TYPES_URL, KETONE_METHODS_URL])
    async def test_requires_authentication(self, client, url):
        response = await client.get(url)
        assert response.status_code == 401

    @pytest.mark.parametrize("role", NON_ADMIN_ROLES)
    @pytest.mark.parametrize("url", [USERS_URL, AUDIT_URL, SEIZURE_TYPES_URL, KETONE_METHODS_URL])
    async def test_only_admin_reads(self, client, session, make_user, auth_headers, role, url):
        user = await make_user(role)
        response = await client.get(url, headers=auth_headers(user))
        assert response.status_code == 403

    @pytest.mark.parametrize("role", NON_ADMIN_ROLES)
    async def test_only_admin_writes(self, client, session, make_user, auth_headers, role):
        user = await make_user(role)
        target = await make_user(UserRole.PARENT)

        patched = await client.patch(
            f"{USERS_URL}/{target.id}", json={"is_active": False}, headers=auth_headers(user)
        )
        assert patched.status_code == 403

        created = await client.post(
            SEIZURE_TYPES_URL, json={"name_ru": "Новый"}, headers=auth_headers(user)
        )
        assert created.status_code == 403
        assert target.is_active is True


class TestListUsers:
    async def test_lists_accounts_without_secrets(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        doctor = await make_user(UserRole.DOCTOR)

        response = await client.get(f"{USERS_URL}?limit=200", headers=auth_headers(admin))
        assert response.status_code == 200, response.text

        body = response.json()
        listed = {item["id"]: item for item in body["items"]}
        assert str(doctor.id) in listed

        card = listed[str(doctor.id)]
        assert card["role"] == "doctor"
        # Список учётных записей — не клинические данные, но и лишнего в нём быть
        # не должно: хеш пароля и секрет 2FA не покидают сервер.
        assert set(card) == {
            "id",
            "role",
            "full_name",
            "email",
            "phone",
            "is_active",
            "created_at",
        }

    async def test_pagination(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        await make_user(UserRole.PARENT)

        response = await client.get(f"{USERS_URL}?limit=1&offset=0", headers=auth_headers(admin))
        body = response.json()
        assert len(body["items"]) == 1
        assert body["total"] >= 2

    @pytest.mark.parametrize("query", ["limit=0", "limit=500", "offset=-1"])
    async def test_invalid_pagination_rejected(
        self, client, session, make_user, auth_headers, query
    ):
        admin = await make_user(UserRole.ADMIN)
        response = await client.get(f"{USERS_URL}?{query}", headers=auth_headers(admin))
        assert response.status_code == 422


class TestUpdateUser:
    async def test_updates_profile_fields(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        target = await make_user(UserRole.PARENT)

        response = await client.patch(
            f"{USERS_URL}/{target.id}",
            json={"full_name": "Иванова Мария", "phone": "+998901112233"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200, response.text
        assert response.json()["full_name"] == "Иванова Мария"
        assert response.json()["phone"] == "+998901112233"

    async def test_phone_can_be_cleared(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        target = await make_user(UserRole.PARENT)
        target.phone = "+998901112233"
        await session.flush()

        response = await client.patch(
            f"{USERS_URL}/{target.id}", json={"phone": None}, headers=auth_headers(admin)
        )
        assert response.status_code == 200
        assert response.json()["phone"] is None

    async def test_deactivation_is_audited_with_before_and_after(
        self, client, session, make_user, auth_headers
    ):
        """Раздел 4.2 ТЗ: операции с учётными записями обязательны к аудиту."""
        admin = await make_user(UserRole.ADMIN)
        target = await make_user(UserRole.DOCTOR)

        response = await client.patch(
            f"{USERS_URL}/{target.id}", json={"is_active": False}, headers=auth_headers(admin)
        )
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        entry = next(
            e for e in await _audit_entries(session, entity="users") if e.entity_id == target.id
        )
        assert entry.user_id == admin.id, "автор изменения — админ, а не тот, кого меняют"
        assert entry.action == "update"
        assert entry.before["is_active"] is True
        assert entry.after["is_active"] is False

    async def test_role_change_is_audited(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        target = await make_user(UserRole.PARENT)

        response = await client.patch(
            f"{USERS_URL}/{target.id}", json={"role": "dietitian"}, headers=auth_headers(admin)
        )
        assert response.status_code == 200
        assert response.json()["role"] == "dietitian"

        entry = next(
            e for e in await _audit_entries(session, entity="users") if e.entity_id == target.id
        )
        assert entry.before["role"] == "parent"
        assert entry.after["role"] == "dietitian"

    async def test_cannot_deactivate_self(self, client, session, make_user, auth_headers):
        """Иначе последний администратор одним запросом оставит систему без администрирования."""
        admin = await make_user(UserRole.ADMIN)

        response = await client.patch(
            f"{USERS_URL}/{admin.id}", json={"is_active": False}, headers=auth_headers(admin)
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "conflict"

        stored = await session.get(User, admin.id)
        assert stored.is_active is True

    async def test_cannot_change_own_role(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)

        response = await client.patch(
            f"{USERS_URL}/{admin.id}", json={"role": "doctor"}, headers=auth_headers(admin)
        )
        assert response.status_code == 409

        stored = await session.get(User, admin.id)
        assert stored.role is UserRole.ADMIN

    async def test_own_profile_fields_still_editable(
        self, client, session, make_user, auth_headers
    ):
        """Запрет касается только потери прав, а не своей карточки целиком."""
        admin = await make_user(UserRole.ADMIN)

        response = await client.patch(
            f"{USERS_URL}/{admin.id}",
            json={"full_name": "Админ Админович", "role": "admin", "is_active": True},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["full_name"] == "Админ Админович"

    async def test_another_admin_can_deactivate_admin(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        other_admin = await make_user(UserRole.ADMIN)

        response = await client.patch(
            f"{USERS_URL}/{other_admin.id}",
            json={"is_active": False},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

    async def test_unknown_user_not_found(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.patch(
            f"{USERS_URL}/{uuid.uuid4()}", json={"is_active": False}, headers=auth_headers(admin)
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"

    @pytest.mark.parametrize(
        "payload",
        [
            {},  # ни одного поля
            {"role": "superuser"},  # роли нет в перечислении
            {"full_name": None},  # NOT NULL нельзя очистить
            {"full_name": ""},
            {"is_active": None},
            {"email": "new@example.com"},  # email через админку не меняется
            {"password": "hunter2hunter2"},
        ],
    )
    async def test_invalid_payload_rejected(
        self, client, session, make_user, auth_headers, payload
    ):
        admin = await make_user(UserRole.ADMIN)
        target = await make_user(UserRole.PARENT)

        response = await client.patch(
            f"{USERS_URL}/{target.id}", json=payload, headers=auth_headers(admin)
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"


class TestAuditLog:
    async def test_filters_by_entity_action_and_user(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        target = await make_user(UserRole.PARENT)

        await client.patch(
            f"{USERS_URL}/{target.id}", json={"is_active": False}, headers=auth_headers(admin)
        )

        response = await client.get(
            f"{AUDIT_URL}?entity=users&action=update&user_id={admin.id}",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert items, "запись об изменении учётной записи должна попасть в журнал"
        assert all(i["entity"] == "users" and i["action"] == "update" for i in items)
        assert any(i["entity_id"] == str(target.id) for i in items)

    async def test_filters_by_period(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        target = await make_user(UserRole.PARENT)
        await client.patch(
            f"{USERS_URL}/{target.id}", json={"is_active": False}, headers=auth_headers(admin)
        )

        now = datetime.now(UTC)
        inside = await client.get(
            AUDIT_URL,
            params={
                "entity": "users",
                "from": (now - timedelta(days=1)).isoformat(),
                "to": (now + timedelta(days=1)).isoformat(),
            },
            headers=auth_headers(admin),
        )
        assert inside.status_code == 200, inside.text
        assert inside.json()["total"] >= 1

        outside = await client.get(
            AUDIT_URL,
            params={"entity": "users", "from": (now + timedelta(days=1)).isoformat()},
            headers=auth_headers(admin),
        )
        assert outside.json()["total"] == 0

    async def test_reversed_period_rejected(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        now = datetime.now(UTC)
        response = await client.get(
            AUDIT_URL,
            params={"from": now.isoformat(), "to": (now - timedelta(days=1)).isoformat()},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_clinical_payload_is_hidden(self, client, session, make_user, auth_headers):
        """Админ видит факт изменения назначения, но не его содержимое:
        доступа к клиническим данным у него нет (раздел 5.1 ТЗ)."""
        admin = await make_user(UserRole.ADMIN)
        doctor = await make_user(UserRole.DOCTOR)
        prescription_id = uuid.uuid4()

        await audit_repo.write_audit_log(
            session,
            user_id=doctor.id,
            action="create",
            entity="prescriptions",
            entity_id=prescription_id,
            after={"ratio": 3.0, "kcal_per_day": 1200, "patient_id": str(uuid.uuid4())},
        )

        response = await client.get(
            f"{AUDIT_URL}?entity=prescriptions", headers=auth_headers(admin)
        )
        entry = next(i for i in response.json()["items"] if i["entity_id"] == str(prescription_id))
        assert entry["after"] is None
        assert entry["before"] is None
        assert entry["payload_hidden"] is True
        assert entry["action"] == "create", "сам факт операции остаётся виден"
        assert "ratio" not in response.text

    async def test_account_payload_is_visible(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        target = await make_user(UserRole.PARENT)
        await client.patch(
            f"{USERS_URL}/{target.id}", json={"is_active": False}, headers=auth_headers(admin)
        )

        response = await client.get(f"{AUDIT_URL}?entity=users", headers=auth_headers(admin))
        entry = next(i for i in response.json()["items"] if i["entity_id"] == str(target.id))
        assert entry["payload_hidden"] is False
        assert entry["before"]["is_active"] is True
        assert entry["after"]["is_active"] is False

    @pytest.mark.parametrize("method", ["post", "patch", "delete"])
    async def test_audit_log_is_read_only(self, client, session, make_user, auth_headers, method):
        admin = await make_user(UserRole.ADMIN)
        response = await getattr(client, method)(AUDIT_URL, headers=auth_headers(admin))
        assert response.status_code == 405


class TestDictionaries:
    async def test_lists_seeded_values(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)

        seizures = await client.get(f"{SEIZURE_TYPES_URL}?limit=200", headers=auth_headers(admin))
        assert seizures.status_code == 200, seizures.text
        assert seizures.json()["total"] >= 1

        ketones = await client.get(KETONE_METHODS_URL, headers=auth_headers(admin))
        assert {item["name_ru"] for item in ketones.json()["items"]} >= {"Кровь", "Моча"}

    async def test_create_update_delete_cycle(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)

        created = await client.post(
            SEIZURE_TYPES_URL,
            json={"name_ru": "Гелястический", "sort": 42},
            headers=auth_headers(admin),
        )
        assert created.status_code == 201, created.text
        entry_id = created.json()["id"]

        renamed = await client.patch(
            f"{SEIZURE_TYPES_URL}/{entry_id}",
            json={"name_ru": "Геластический"},
            headers=auth_headers(admin),
        )
        assert renamed.status_code == 200
        assert renamed.json()["name_ru"] == "Геластический"
        assert renamed.json()["sort"] == 42, "непереданное поле не сбрасывается"

        deleted = await client.delete(
            f"{SEIZURE_TYPES_URL}/{entry_id}", headers=auth_headers(admin)
        )
        assert deleted.status_code == 204
        assert await session.get(SeizureType, uuid.UUID(entry_id)) is None

    async def test_changes_are_audited(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        created = await client.post(
            SEIZURE_TYPES_URL, json={"name_ru": "Черновой"}, headers=auth_headers(admin)
        )
        entry_id = uuid.UUID(created.json()["id"])

        await client.patch(
            f"{SEIZURE_TYPES_URL}/{entry_id}",
            json={"name_ru": "Уточнённый"},
            headers=auth_headers(admin),
        )

        entries = [
            e
            for e in await _audit_entries(session, entity="seizure_types")
            if e.entity_id == entry_id
        ]
        actions = {e.action for e in entries}
        assert actions == {"create", "update"}
        update_entry = next(e for e in entries if e.action == "update")
        assert update_entry.before["name_ru"] == "Черновой"
        assert update_entry.after["name_ru"] == "Уточнённый"

    async def test_referenced_value_cannot_be_deleted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Иначе запись о приступе осталась бы без типа: восстановить его неоткуда."""
        admin = await make_user(UserRole.ADMIN)
        patient = await make_patient()

        created = await client.post(
            SEIZURE_TYPES_URL, json={"name_ru": "Используемый"}, headers=auth_headers(admin)
        )
        entry_id = uuid.UUID(created.json()["id"])

        session.add(
            SeizureLog(
                patient_id=patient.id,
                occurred_at=datetime.now(UTC),
                source=DiarySource.WEB,
                seizure_type_id=entry_id,
                count=1,
            )
        )
        await session.flush()

        response = await client.delete(
            f"{SEIZURE_TYPES_URL}/{entry_id}", headers=auth_headers(admin)
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "conflict"
        assert response.json()["error"]["details"]["references"] == 1
        assert await session.get(SeizureType, entry_id) is not None

    async def test_soft_deleted_log_still_blocks_deletion(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Мягко удалённая запись остаётся в БД и в отчётах — тип ей всё ещё нужен."""
        admin = await make_user(UserRole.ADMIN)
        patient = await make_patient()

        created = await client.post(
            SEIZURE_TYPES_URL, json={"name_ru": "Удалённый лог"}, headers=auth_headers(admin)
        )
        entry_id = uuid.UUID(created.json()["id"])

        session.add(
            SeizureLog(
                patient_id=patient.id,
                occurred_at=datetime.now(UTC),
                source=DiarySource.WEB,
                seizure_type_id=entry_id,
                count=1,
                deleted_at=datetime.now(UTC),
            )
        )
        await session.flush()

        response = await client.delete(
            f"{SEIZURE_TYPES_URL}/{entry_id}", headers=auth_headers(admin)
        )
        assert response.status_code == 409

    async def test_ketone_method_cycle(self, client, session, make_user, auth_headers):
        """На `ketone_methods` не ссылается ни одна таблица (в `ketone_logs` метод —
        enum-поле по разделу 4.2 ТЗ), поэтому удаление ничего не осиротит."""
        admin = await make_user(UserRole.ADMIN)

        created = await client.post(
            KETONE_METHODS_URL,
            json={"name_ru": "Выдыхаемый воздух", "sort": 3},
            headers=auth_headers(admin),
        )
        assert created.status_code == 201
        entry_id = uuid.UUID(created.json()["id"])

        deleted = await client.delete(
            f"{KETONE_METHODS_URL}/{entry_id}", headers=auth_headers(admin)
        )
        assert deleted.status_code == 204
        assert await session.get(KetoneMethodDict, entry_id) is None

    @pytest.mark.parametrize("url", [SEIZURE_TYPES_URL, KETONE_METHODS_URL])
    async def test_unknown_entry_not_found(self, client, session, make_user, auth_headers, url):
        admin = await make_user(UserRole.ADMIN)
        missing = uuid.uuid4()

        patched = await client.patch(
            f"{url}/{missing}", json={"name_ru": "Нет такого"}, headers=auth_headers(admin)
        )
        assert patched.status_code == 404

        deleted = await client.delete(f"{url}/{missing}", headers=auth_headers(admin))
        assert deleted.status_code == 404

    @pytest.mark.parametrize(
        "payload",
        [
            {},  # name_ru обязателен
            {"name_ru": ""},
            {"name_ru": "Тип", "sort": -1},
            {"name_ru": "Тип", "unknown": 1},
        ],
    )
    async def test_create_validation(self, client, session, make_user, auth_headers, payload):
        admin = await make_user(UserRole.ADMIN)
        response = await client.post(SEIZURE_TYPES_URL, json=payload, headers=auth_headers(admin))
        assert response.status_code == 422, response.text

    @pytest.mark.parametrize("payload", [{}, {"name_ru": None}, {"sort": None}])
    async def test_update_validation(self, client, session, make_user, auth_headers, payload):
        admin = await make_user(UserRole.ADMIN)
        created = await client.post(
            SEIZURE_TYPES_URL, json={"name_ru": "Проверка"}, headers=auth_headers(admin)
        )
        entry_id = created.json()["id"]

        response = await client.patch(
            f"{SEIZURE_TYPES_URL}/{entry_id}", json=payload, headers=auth_headers(admin)
        )
        assert response.status_code == 422, response.text
