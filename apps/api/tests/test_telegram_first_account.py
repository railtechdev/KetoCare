"""Учётная запись родителя без почты и пароля (ADR-0040, этап Б).

Смысл этапа: семья выходит от врача с кодом и начинает вести дневник в тот же
день, не заводя ни почты, ни пароля. Веб она включает сама и потом.

Здесь проверяется то, что от этого ломается, если не уследить: вход по паролю,
временный пароль от администратора, смена несуществующего пароля — и сама
дверь в кабинет, `POST /users/me/credentials`.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from core.config import get_settings
from core.models import AccessCode, TelegramAccount, User
from core.models.enums import UserRole
from core.repositories import access as access_repo
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo

CHAT_ID = 771002003


def bot_headers() -> dict[str, str]:
    token = get_settings().bot_api_token
    assert token, "BOT_API_TOKEN не задан: канал бота выключен, проверять нечего."
    return {"X-Bot-Token": token}


@pytest.mark.asyncio
class TestBornInTelegram:
    async def test_parent_has_neither_email_nor_password(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient("Амина")
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        code = (
            await client.post(
                f"/api/v1/patients/{patient.id}/access-codes", headers=auth_headers(doctor)
            )
        ).json()["code"]

        response = await client.post(
            "/api/v1/auth/access-codes/activate-telegram",
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": CHAT_ID,
                "telegram_user_id": CHAT_ID,
                "first_name": "Айгуль",
                "last_name": "Сериковна",
            },
        )
        assert response.status_code == 201, response.text

        parent = await session.scalar(select(User).where(User.telegram_user_id == CHAT_ID))
        assert parent is not None
        assert parent.full_name == "Айгуль Сериковна"
        assert parent.email is None
        assert parent.password_hash is None
        assert parent.invited_by == doctor.id, "след от выдачи к учётной записи (ADR-0003)"

    async def test_second_code_to_the_same_person_adds_a_second_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Второй ребёнок на терапии — тот же человек, та же учётная запись."""

        doctor = await make_user(UserRole.DOCTOR)
        auth = auth_headers(doctor)
        first = await make_patient("Первый")
        second = await make_patient("Второй")
        for patient in (first, second):
            await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        for index, patient in enumerate((first, second)):
            code = (
                await client.post(f"/api/v1/patients/{patient.id}/access-codes", headers=auth)
            ).json()["code"]
            response = await client.post(
                "/api/v1/auth/access-codes/activate-telegram",
                headers=bot_headers(),
                json={
                    # Разные чаты, один человек: так и бывает — телефон и рабочий
                    # компьютер. Учётная запись обязана остаться одной.
                    "code": code,
                    "chat_id": CHAT_ID + index,
                    "telegram_user_id": CHAT_ID,
                    "first_name": "Айгуль",
                },
            )
            assert response.status_code == 201, response.text

        parents = list(
            (await session.scalars(select(User).where(User.telegram_user_id == CHAT_ID))).all()
        )
        assert len(parents) == 1, "второй код не должен заводить вторую учётную запись"

    async def test_parent_code_binds_to_the_issuer_not_to_a_new_account(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Код, выпущенный родителем себе, — это «подключить ещё один чат».

        Заводить на него вторую учётную запись значило бы разложить одну семью
        по двум кабинетам: в одном пароль и история, в другом — бот.
        """

        parent = await make_user(UserRole.PARENT)
        patient = await make_patient("Амина")
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        code = (
            await client.post(
                f"/api/v1/patients/{patient.id}/access-codes", headers=auth_headers(parent)
            )
        ).json()["code"]

        response = await client.post(
            "/api/v1/auth/access-codes/activate-telegram",
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": CHAT_ID,
                "telegram_user_id": CHAT_ID,
                "first_name": "Айгуль",
            },
        )
        assert response.status_code == 201, response.text

        # Вторая учётная запись не заведена — чат привязан к выпустившему.
        assert (await session.scalar(select(User).where(User.telegram_user_id == CHAT_ID))) is None
        link = await session.scalar(
            select(TelegramAccount).where(TelegramAccount.chat_id == CHAT_ID)
        )
        assert link is not None and link.parent_id == parent.id

        # А удостоверением учётная запись не обзавелась: код мог дойти не до
        # того человека, и чужой Telegram стал бы её постоянным ключом.
        await session.refresh(parent)
        assert parent.telegram_user_id is None


@pytest.mark.asyncio
class TestLoginStaysHonest:
    async def test_account_without_password_answers_like_a_wrong_one(
        self, client, session, make_user
    ):
        """Никакого оракула: «сюда паролем не входят» назвало бы существующую
        учётную запись."""

        parent = await users_repo.create(
            session, role=UserRole.PARENT, full_name="Айгуль", telegram_user_id=CHAT_ID
        )
        assert parent.email is None

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "kto-to@example.com", "password": "любой-пароль-1234"},
        )
        assert response.status_code == 401

    async def test_empty_email_does_not_match_a_telegram_parent(self, client, session):
        """`get_by_email(None)` вернул бы первого попавшегося родителя.

        SQLAlchemy превратила бы сравнение с `None` в `email IS NULL`, и вход
        стал бы дверью без пароля. Проверяется на уровне репозитория: ручка
        валидирует почту раньше.
        """

        await users_repo.create(
            session, role=UserRole.PARENT, full_name="Айгуль", telegram_user_id=CHAT_ID
        )

        assert await users_repo.get_by_email(session, None) is None


@pytest.mark.asyncio
class TestCredentials:
    async def test_parent_turns_on_the_web_cabinet(self, client, session, auth_headers):
        parent = await users_repo.create(
            session, role=UserRole.PARENT, full_name="Айгуль", telegram_user_id=CHAT_ID
        )

        response = await client.post(
            "/api/v1/users/me/credentials",
            headers=auth_headers(parent),
            json={"email": "aigul@example.com", "password": "очень-длинный-пароль"},
        )
        assert response.status_code == 201, response.text
        assert response.json()["email"] == "aigul@example.com"

        await session.refresh(parent)
        assert parent.password_hash is not None

        # И этим паролем теперь входят.
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "aigul@example.com", "password": "очень-длинный-пароль"},
        )
        assert login.status_code == 200, login.text

    async def test_second_call_is_refused(self, client, session, auth_headers):
        """Иначе ручка стала бы сменой пароля в обход знания прежнего."""

        parent = await users_repo.create(
            session, role=UserRole.PARENT, full_name="Айгуль", telegram_user_id=CHAT_ID
        )
        body = {"email": "aigul@example.com", "password": "очень-длинный-пароль"}

        assert (
            await client.post(
                "/api/v1/users/me/credentials", headers=auth_headers(parent), json=body
            )
        ).status_code == 201

        again = await client.post(
            "/api/v1/users/me/credentials",
            headers=auth_headers(parent),
            json={"email": "another@example.com", "password": "другой-длинный-пароль"},
        )
        assert again.status_code == 409
        assert again.json()["error"]["code"] == "conflict"

    async def test_taken_email_explains_what_to_do(self, client, session, make_user, auth_headers):
        neighbour = await make_user(UserRole.PARENT)
        parent = await users_repo.create(
            session, role=UserRole.PARENT, full_name="Айгуль", telegram_user_id=CHAT_ID
        )

        response = await client.post(
            "/api/v1/users/me/credentials",
            headers=auth_headers(parent),
            json={"email": neighbour.email, "password": "очень-длинный-пароль"},
        )
        assert response.status_code == 409
        assert "по коду" in response.json()["error"]["message"]

    async def test_staff_cannot_call_it(self, client, make_user, auth_headers):
        """У сотрудника вход один, и второй двери к нему быть не должно."""

        doctor = await make_user(UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/users/me/credentials",
            headers=auth_headers(doctor),
            json={"email": "doctor2@example.com", "password": "очень-длинный-пароль"},
        )
        assert response.status_code == 403

    async def test_change_password_says_there_is_none(self, client, session, auth_headers):
        """«Текущий пароль неверен» было бы неправдой: пароля нет вовсе."""

        parent = await users_repo.create(
            session, role=UserRole.PARENT, full_name="Айгуль", telegram_user_id=CHAT_ID
        )

        response = await client.post(
            "/api/v1/users/me/password",
            headers=auth_headers(parent),
            json={"current_password": "что угодно", "new_password": "очень-длинный-пароль"},
        )
        assert response.status_code == 409
        assert "нет пароля" in response.json()["error"]["message"]


@pytest.mark.asyncio
class TestAdminSeesTheLimit:
    async def test_temporary_password_refused_without_email(
        self, client, session, make_user, auth_headers
    ):
        """Пароль без логина — обещание доступа, которого нет.

        Администратор увидел бы «пароль выдан», продиктовал бы его семье, и та
        не смогла бы войти ничем: поля почты у неё нет.
        """

        admin = await make_user(UserRole.ADMIN)
        parent = await users_repo.create(
            session, role=UserRole.PARENT, full_name="Айгуль", telegram_user_id=CHAT_ID
        )

        response = await client.post(
            f"/api/v1/admin/users/{parent.id}/reset-password", headers=auth_headers(admin)
        )
        assert response.status_code == 409
        assert "почты" in response.json()["error"]["message"]

    async def test_such_account_is_visible_in_the_list(
        self, client, session, make_user, auth_headers
    ):
        """Пустая почта — не повод спрятать учётную запись от администратора."""

        admin = await make_user(UserRole.ADMIN)
        await users_repo.create(
            session, role=UserRole.PARENT, full_name="Айгуль из Telegram", telegram_user_id=CHAT_ID
        )

        response = await client.get("/api/v1/admin/users?limit=200", headers=auth_headers(admin))
        assert response.status_code == 200, response.text

        listed = [
            item for item in response.json()["items"] if item["full_name"] == "Айгуль из Telegram"
        ]
        assert listed, "учётная запись без почты обязана быть видна"
        assert listed[0]["email"] is None


@pytest.mark.asyncio
class TestParentCodeStaysInTelegram:
    """Код, выпущенный родителем, — это подключение чата, а не выдача доступа.

    До этапа Б родитель не мог открыть карту ребёнка никому: у него был только
    код привязки Telegram. Общий код доступа сделал бы это молча — семья начала
    бы раздавать постоянные кабинеты. Решение 3 ADR-0040 оставляет выдачу
    доступа специалисту, и это должно исполняться сервером, а не текстом на
    экране.
    """

    async def _parent_code(self, client, session, make_user, make_patient, auth_headers):
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient("Амина")
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        code = (
            await client.post(
                f"/api/v1/patients/{patient.id}/access-codes", headers=auth_headers(parent)
            )
        ).json()["code"]
        return parent, patient, code

    async def test_join_refuses_a_parent_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, _, code = await self._parent_code(client, session, make_user, make_patient, auth_headers)

        response = await client.post(
            "/api/v1/auth/access-codes/activate",
            json={
                "code": code,
                "email": "stranger@example.com",
                "full_name": "Посторонний Взрослый",
                "password": "очень-длинный-пароль",
            },
        )
        assert response.status_code == 409, response.text
        assert "у врача" in response.json()["error"]["message"]

        # Код не сгорел: он предназначался боту и ещё пригодится.
        stored = await session.get(AccessCode, code)
        assert stored is not None and stored.used_at is None

    async def test_cabinet_refuses_a_parent_code(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, _, code = await self._parent_code(client, session, make_user, make_patient, auth_headers)
        neighbour = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/users/me/access-codes/activate",
            headers=auth_headers(neighbour),
            json={"code": code},
        )
        assert response.status_code == 409

    async def test_someone_elses_telegram_does_not_become_the_issuer_identity(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Главное последствие, ради которого удостоверение не проставляется.

        Родитель передал свой код второму взрослому. Тот вводит его в боте —
        чат привязывается к учётной записи родителя (так же работал код
        привязки), но `telegram_user_id` у неё НЕ появляется. Иначе этот чужой
        Telegram стал бы «знакомым», и код врача на другого ребёнка привязал бы
        того ребёнка к учётной записи первого родителя — то есть открыл бы ему
        чужую семью.
        """

        parent, _, code = await self._parent_code(
            client, session, make_user, make_patient, auth_headers
        )
        stranger_telegram = CHAT_ID + 77

        activated = await client.post(
            "/api/v1/auth/access-codes/activate-telegram",
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": stranger_telegram,
                "telegram_user_id": stranger_telegram,
                "first_name": "Бабушка",
            },
        )
        assert activated.status_code == 201, activated.text

        await session.refresh(parent)
        assert parent.telegram_user_id is None

        # И проверка того самого последствия: код врача на ЧУЖОГО ребёнка из
        # этого Telegram заводит новую учётную запись, а не открывает карту
        # первому родителю.
        doctor = await make_user(UserRole.DOCTOR)
        other = await make_patient("Чужой ребёнок")
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=other.id)
        doctor_code = (
            await client.post(
                f"/api/v1/patients/{other.id}/access-codes", headers=auth_headers(doctor)
            )
        ).json()["code"]

        second = await client.post(
            "/api/v1/auth/access-codes/activate-telegram",
            headers=bot_headers(),
            json={
                "code": doctor_code,
                "chat_id": stranger_telegram + 1,
                "telegram_user_id": stranger_telegram,
                "first_name": "Бабушка",
            },
        )
        assert second.status_code == 201, second.text

        assert not await access_repo.user_has_patient_access(
            session, user_id=parent.id, role=UserRole.PARENT, patient_id=other.id
        ), "чужой ребёнок не должен появиться в кабинете первого родителя"
