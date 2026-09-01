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
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

USERS_URL = "/api/v1/admin/users"
AUDIT_URL = "/api/v1/admin/audit-log"
SEIZURE_TYPES_URL = "/api/v1/admin/dictionaries/seizure-types"
KETONE_METHODS_URL = "/api/v1/admin/dictionaries/ketone-methods"
# Чтение справочников вынесено из `/admin`: список типов приступов нужен семье,
# чтобы вообще записать приступ (см. routers/dictionaries.py).
READ_SEIZURE_TYPES_URL = "/api/v1/dictionaries/seizure-types"
READ_KETONE_METHODS_URL = "/api/v1/dictionaries/ketone-methods"

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
    @pytest.mark.parametrize("url", [USERS_URL, AUDIT_URL])
    async def test_requires_authentication(self, client, url):
        response = await client.get(url)
        assert response.status_code == 401

    @pytest.mark.parametrize("role", NON_ADMIN_ROLES)
    @pytest.mark.parametrize("url", [USERS_URL, AUDIT_URL])
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
        # не должно: хеш пароля и секрет 2FA не покидают сервер. Наружу уходит
        # только признак `has_totp` — по нему администратор видит, есть ли что
        # сбрасывать; сам секрет не отдаётся никогда.
        assert card["has_totp"] is False
        assert "totp_secret" not in card
        assert set(card) == {
            "id",
            "has_totp",
            # Счётчик связей, а не клинические данные: сколько пациентов
            # останутся без ведущего, если учётку отключить.
            "sole_patients",
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

    async def test_filters_by_entity_id(self, client, session, make_user, auth_headers):
        # История правок одной позиции: без этого фильтра интерфейс тянул страницу
        # журнала целиком и отбирал строки у себя — то есть история обрывалась
        # там, где кончалась страница.
        admin = await make_user(UserRole.ADMIN)
        target = await make_user(UserRole.PARENT)
        other = await make_user(UserRole.PARENT)

        for user in (target, other):
            await client.patch(
                f"{USERS_URL}/{user.id}", json={"is_active": False}, headers=auth_headers(admin)
            )

        response = await client.get(
            AUDIT_URL, params={"entity_id": str(target.id)}, headers=auth_headers(admin)
        )

        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert items, "запись об изменении должна попасть в журнал"
        assert {i["entity_id"] for i in items} == {str(target.id)}

    async def test_rejects_non_uuid_entity_id(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.get(
            AUDIT_URL, params={"entity_id": "не-uuid"}, headers=auth_headers(admin)
        )
        assert response.status_code == 422

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

        seizures = await client.get(
            f"{READ_SEIZURE_TYPES_URL}?limit=200", headers=auth_headers(admin)
        )
        assert seizures.status_code == 200, seizures.text
        assert seizures.json()["total"] >= 1

        ketones = await client.get(READ_KETONE_METHODS_URL, headers=auth_headers(admin))
        assert {item["name_ru"] for item in ketones.json()["items"]} >= {"Кровь", "Моча"}

    @pytest.mark.parametrize("url", [READ_SEIZURE_TYPES_URL, READ_KETONE_METHODS_URL])
    async def test_reading_requires_authentication(self, client, url):
        assert (await client.get(url)).status_code == 401

    @pytest.mark.parametrize("role", NON_ADMIN_ROLES)
    @pytest.mark.parametrize("url", [READ_SEIZURE_TYPES_URL, READ_KETONE_METHODS_URL])
    async def test_every_role_reads_dictionaries(
        self, client, session, make_user, auth_headers, role, url
    ):
        # Без списка типов приступов семья не может сохранить запись о приступе
        # (раздел 7.3 ТЗ), а врач видит в дневнике идентификатор вместо названия.
        # Правка при этом остаётся за админом — проверяется test_only_admin_writes.
        user = await make_user(role)
        response = await client.get(url, headers=auth_headers(user))
        assert response.status_code == 200, response.text

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


class TestDeactivationKeepsPatientsVisible:
    """Отключение специалиста не должно оставлять пациентов без ведущего.

    Сервер защищает этот инвариант при снятии специалиста вручную
    (`remove_patient_doctor`), но отключение учётной записи его обходило: связи
    остаются, а войти по ним больше некому — и «взять» такого пациента другой
    врач не может, ручки нет намеренно (ADR-0003).
    """

    async def test_cannot_deactivate_the_only_doctor_of_a_patient(
        self, client, session, make_user, make_patient, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.patch(
            f"/api/v1/admin/users/{doctor.id}",
            json={"is_active": False},
            headers=auth_headers(admin),
        )

        assert response.status_code == 409
        body = response.json()["error"]
        assert body["code"] == "conflict"
        # Сообщение называет число и следующий шаг, а не просто отказывает.
        assert "1" in body["message"] and "коллеге" in body["message"]

    async def test_role_change_is_guarded_too(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Разжалование врача в родителя снимает с пациента ведущего так же."""

        admin = await make_user(UserRole.ADMIN)
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.patch(
            f"/api/v1/admin/users/{doctor.id}",
            json={"role": "parent"},
            headers=auth_headers(admin),
        )

        assert response.status_code == 409

    async def test_second_specialist_makes_deactivation_possible(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Пациента передали коллеге — отключение проходит."""

        admin = await make_user(UserRole.ADMIN)
        doctor = await make_user(UserRole.DOCTOR)
        colleague = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        await patients_repo.link_doctor(session, doctor_id=colleague.id, patient_id=patient.id)

        response = await client.patch(
            f"/api/v1/admin/users/{doctor.id}",
            json={"is_active": False},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200

    async def test_list_says_how_many_patients_depend_on_the_account(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Счётчик виден администратору до нажатия, а не после отказа."""

        admin = await make_user(UserRole.ADMIN)
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.get("/api/v1/admin/users", headers=auth_headers(admin))

        rows = {item["id"]: item for item in response.json()["items"]}
        assert rows[str(doctor.id)]["sole_patients"] == 1
        assert rows[str(admin.id)]["sole_patients"] == 0


class TestSeizureTypeCode:
    """Короткий код типа приступа (ADR-0007).

    Без кода месячная сетка дневника подставляет в клетку полное название, а в
    легенду тип не попадает вовсе: новый тип, заведённый администратором, ломал
    ровно то, ради чего коды и вводились.
    """

    async def test_code_is_saved_and_returned(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)

        response = await client.post(
            "/api/v1/admin/dictionaries/seizure-types",
            json={"name_ru": "Тонико-клонический", "code": "TC", "sort": 10},
            headers=auth_headers(admin),
        )

        assert response.status_code == 201, response.text
        assert response.json()["code"] == "TC"

    async def test_code_can_be_cleared_but_name_cannot(self, client, make_user, auth_headers):
        """Тип без кода — допустимое состояние (вопрос 4 медкоманде), а тип без
        названия — нет."""

        admin = await make_user(UserRole.ADMIN)
        created = await client.post(
            "/api/v1/admin/dictionaries/seizure-types",
            json={"name_ru": "Атонический", "code": "A"},
            headers=auth_headers(admin),
        )
        entry_id = created.json()["id"]

        cleared = await client.patch(
            f"/api/v1/admin/dictionaries/seizure-types/{entry_id}",
            json={"code": None},
            headers=auth_headers(admin),
        )
        assert cleared.status_code == 200
        assert cleared.json()["code"] is None

        empty_name = await client.patch(
            f"/api/v1/admin/dictionaries/seizure-types/{entry_id}",
            json={"name_ru": None},
            headers=auth_headers(admin),
        )
        assert empty_name.status_code == 422

    async def test_untouched_code_survives_rename(self, client, make_user, auth_headers):
        """Переименование без упоминания кода код не стирает."""

        admin = await make_user(UserRole.ADMIN)
        created = await client.post(
            "/api/v1/admin/dictionaries/seizure-types",
            json={"name_ru": "Миоклонический", "code": "M"},
            headers=auth_headers(admin),
        )
        entry_id = created.json()["id"]

        renamed = await client.patch(
            f"/api/v1/admin/dictionaries/seizure-types/{entry_id}",
            json={"name_ru": "Миоклонические приступы"},
            headers=auth_headers(admin),
        )

        assert renamed.json()["code"] == "M"

    async def test_ketone_methods_have_no_code(self, client, make_user, auth_headers):
        """У методов измерения кода нет и быть не должно: общая схема выдавала
        бы им пустое поле и предлагала его заполнить."""

        admin = await make_user(UserRole.ADMIN)

        response = await client.post(
            "/api/v1/admin/dictionaries/ketone-methods",
            json={"name_ru": "По слюне", "code": "S"},
            headers=auth_headers(admin),
        )

        assert response.status_code == 422
