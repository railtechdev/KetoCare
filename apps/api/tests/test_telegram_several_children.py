"""Один Telegram ведёт нескольких детей (ADR-0048).

Семья с двумя детьми на диете и бабушка двоих внуков прежде вели второго
ребёнка только в кабинете: чат принадлежал одному ребёнку. Здесь проверяется,
что чат получает второго ребёнка тем же кодом, и — главное — что сужение
сессии до одного ребёнка от этого не размывается: токен ребёнка А не читает
ребёнка Б, переключение требует живой привязки ЭТОГО чата, а отзыв одной
привязки не гасит другую.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from api.security import decode_token
from core.config import get_settings
from core.models import AuditLog, TelegramAccount, User
from core.models.enums import UserRole
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo

from .test_miniapp_auth import BOT_TOKEN, init_data
from .test_telegram_first_account import bot_headers

CHAT_ID = 771_048_001
ACTIVATE = "/api/v1/auth/access-codes/activate-telegram"
INIT = "/api/v1/auth/telegram-init"
SWITCH = "/api/v1/auth/miniapp/switch"

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _bot_token(monkeypatch):
    """Подпись строки запуска считается тем же токеном, что в `test_miniapp_auth`."""

    monkeypatch.setenv("BOT_TOKEN", BOT_TOKEN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def _code(client, auth_headers, issuer, patient) -> str:
    response = await client.post(
        f"/api/v1/patients/{patient.id}/access-codes", headers=auth_headers(issuer)
    )
    assert response.status_code == 201, response.text
    return str(response.json()["code"])


async def _activate(client, code: str, *, chat_id: int = CHAT_ID):
    return await client.post(
        ACTIVATE,
        headers=bot_headers(),
        json={
            "code": code,
            "chat_id": chat_id,
            "telegram_user_id": chat_id,
            "first_name": "Бабушка",
        },
    )


async def _two_grandchildren(client, session, make_user, make_patient, auth_headers):
    """Врач ведёт двоих детей и выдал по коду на каждого; бабушка гасит оба в одном чате."""

    doctor = await make_user(UserRole.DOCTOR)
    first = await make_patient("Аня Иванова")
    second = await make_patient("Тимур Иванов")
    for child in (first, second):
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=child.id)

    linked = []
    for child in (first, second):
        response = await _activate(client, await _code(client, auth_headers, doctor, child))
        assert response.status_code == 201, response.text
        linked.append(response.json())
    return doctor, first, second, linked


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestSecondChildInTheSameChat:
    async def test_code_for_another_child_links_it_too(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, first, second, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )

        live = list(
            (
                await session.scalars(
                    select(TelegramAccount).where(
                        TelegramAccount.chat_id == CHAT_ID, TelegramAccount.revoked_at.is_(None)
                    )
                )
            ).all()
        )
        assert {link.patient_id for link in live} == {first.id, second.id}
        # Тот же человек — та же учётная запись (правило `_parent_behind_telegram`).
        assert len({link.parent_id for link in live}) == 1
        assert (
            len((await session.scalars(select(User).where(User.telegram_user_id == CHAT_ID))).all())
            == 1
        )
        # У каждой привязки свой секрет: отзыв одной не задевает другую.
        assert linked[0]["secret"] != linked[1]["secret"]

    async def test_bot_secrets_stay_scoped_to_their_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, first, second, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        token = (
            await client.post(
                "/api/v1/auth/bot/session",
                headers=bot_headers(),
                json={"link_id": linked[0]["link_id"], "secret": linked[0]["secret"]},
            )
        ).json()["access_token"]

        own = await client.post(
            f"/api/v1/patients/{first.id}/logs/ketones",
            headers=_bearer(token),
            json={"value": "2.5", "method": "blood", "occurred_at": "2026-10-05T08:00:00Z"},
        )
        other = await client.post(
            f"/api/v1/patients/{second.id}/logs/ketones",
            headers=_bearer(token),
            json={"value": "2.5", "method": "blood", "occurred_at": "2026-10-05T08:00:00Z"},
        )
        assert own.status_code == 201, own.text
        assert other.status_code in (403, 404)

    async def test_same_child_again_is_still_already_here(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, first, _, _ = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        code = await _code(client, auth_headers, doctor, first)

        # Живой код того же ребёнка из того же личного чата — восстановление
        # секрета (дополнение к ADR-0009), а не вторая привязка.
        response = await _activate(client, code)
        assert response.status_code == 201, response.text
        live = (
            await session.scalars(
                select(TelegramAccount).where(
                    TelegramAccount.chat_id == CHAT_ID,
                    TelegramAccount.patient_id == first.id,
                    TelegramAccount.revoked_at.is_(None),
                )
            )
        ).all()
        assert len(live) == 1

    async def test_staff_telegram_is_refused_for_a_second_child_too(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        nurse_like = await make_user(UserRole.DIETITIAN)
        nurse_like.telegram_user_id = CHAT_ID + 7
        await session.flush()
        child = await make_patient("Аня Иванова")
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=child.id)
        code = await _code(client, auth_headers, doctor, child)

        response = await _activate(client, code, chat_id=CHAT_ID + 7)

        assert response.status_code == 409
        assert response.json()["error"]["details"] == {"reason": "staff_telegram"}


class TestMiniAppChildren:
    async def test_init_lists_the_children_and_opens_the_first(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, first, second, _ = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )

        response = await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["patient_id"] == str(first.id)
        assert body["children"] == [
            {"patient_id": str(first.id), "name": first.full_name},
            {"patient_id": str(second.id), "name": second.full_name},
        ]

    async def test_init_opens_the_named_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, _, second, _ = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )

        body = (
            await client.post(
                INIT, json={"init_data": init_data(chat_id=CHAT_ID), "patient_id": str(second.id)}
            )
        ).json()

        assert body["patient_id"] == str(second.id)
        assert decode_token(body["access_token"], expected_type="access")["patient_scope"] == str(
            second.id
        )

    async def test_init_refuses_a_child_this_telegram_does_not_lead(
        self, client, session, make_user, make_patient, auth_headers
    ):
        await _two_grandchildren(client, session, make_user, make_patient, auth_headers)
        stranger = await make_patient("Чужой Ребёнок")

        response = await client.post(
            INIT, json={"init_data": init_data(chat_id=CHAT_ID), "patient_id": str(stranger.id)}
        )

        assert response.status_code == 404
        assert response.json()["error"]["details"] == {"reason": "child_not_linked"}

    async def test_token_for_one_child_cannot_read_the_other(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, first, second, _ = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        token = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()[
            "access_token"
        ]

        own = await client.get(f"/api/v1/patients/{first.id}/overview", headers=_bearer(token))
        other = await client.get(f"/api/v1/patients/{second.id}/overview", headers=_bearer(token))

        assert own.status_code == 200, own.text
        assert other.status_code in (403, 404)


class TestMiniAppSwitch:
    async def test_switch_opens_a_session_scoped_to_the_other_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, first, second, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        opened = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()

        response = await client.post(
            SWITCH, headers=_bearer(opened["access_token"]), json={"patient_id": str(second.id)}
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["patient_id"] == str(second.id)
        assert [child["patient_id"] for child in body["children"]] == [
            str(first.id),
            str(second.id),
        ]
        claims = decode_token(body["access_token"], expected_type="access")
        assert claims["patient_scope"] == str(second.id)
        assert claims["tg"] == linked[1]["link_id"]
        assert claims["chan"] == "miniapp"

        switched = _bearer(body["access_token"])
        assert (
            await client.get(f"/api/v1/patients/{second.id}/overview", headers=switched)
        ).status_code == 200
        assert (
            await client.get(f"/api/v1/patients/{first.id}/overview", headers=switched)
        ).status_code in (403, 404)

        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "miniapp_switch_child",
                AuditLog.entity_id == opened_link_id(linked, 1),
            )
        )
        assert entry is not None and entry.after == {"patient_id": str(second.id)}

    async def test_switch_requires_a_live_link_of_this_chat(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Связь учётной записи с ребёнком — не повод: нужна привязка ЭТОГО чата."""

        _, first, _, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        parent_id = (await session.get(TelegramAccount, opened_link_id(linked, 0))).parent_id
        # Третий ребёнок той же учётной записи — например, добавленный в кабинете,
        # — но к этому чату не привязанный.
        third = await make_patient("Лейла Иванова")
        await patients_repo.link_parent(session, parent_id=parent_id, patient_id=third.id)
        token = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()[
            "access_token"
        ]

        response = await client.post(
            SWITCH, headers=_bearer(token), json={"patient_id": str(third.id)}
        )

        assert response.status_code == 404
        assert response.json()["error"]["details"] == {"reason": "child_not_linked"}

    async def test_switch_to_a_revoked_child_is_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, _, second, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        token = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()[
            "access_token"
        ]
        await telegram_repo.revoke(session, opened_link_id(linked, 1))

        response = await client.post(
            SWITCH, headers=_bearer(token), json={"patient_id": str(second.id)}
        )

        assert response.status_code == 404

    async def test_revoking_one_link_leaves_the_other_session_alive(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, first, second, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        token_a = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()[
            "access_token"
        ]
        token_b = (
            await client.post(SWITCH, headers=_bearer(token_a), json={"patient_id": str(second.id)})
        ).json()["access_token"]

        await telegram_repo.revoke(session, opened_link_id(linked, 1))

        alive = await client.get(f"/api/v1/patients/{first.id}/overview", headers=_bearer(token_a))
        dead = await client.get(f"/api/v1/patients/{second.id}/overview", headers=_bearer(token_b))
        assert alive.status_code == 200, alive.text
        assert dead.status_code == 401

        # И Mini App больше не предлагает отозванного ребёнка.
        children = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()[
            "children"
        ]
        assert [child["patient_id"] for child in children] == [str(first.id)]

    async def test_web_session_cannot_switch(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        child = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=child.id)

        response = await client.post(
            SWITCH, headers=auth_headers(parent), json={"patient_id": str(child.id)}
        )

        assert response.status_code == 403

    async def test_unknown_field_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        await _two_grandchildren(client, session, make_user, make_patient, auth_headers)
        token = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()[
            "access_token"
        ]

        response = await client.post(
            SWITCH, headers=_bearer(token), json={"patient_id": None, "extra": 1}
        )

        assert response.status_code == 422


def opened_link_id(linked: list[dict], index: int) -> uuid.UUID:
    return uuid.UUID(linked[index]["link_id"])


class TestContractForConsumers:
    """Формы ответов, которые читают другие приложения (правило стыков в CLAUDE.md)."""

    async def test_bot_reads_the_first_name_from_link_verified(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Потребитель — `apps/bot` (`bot.api.LinkVerified.patient_first_name`)."""

        _, first, _, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        assert linked[0]["patient_name"] == first.full_name
        assert linked[0]["patient_first_name"] == "Аня"

    async def test_miniapp_reads_children_and_switch_answers_the_same_shape(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Потребитель — `apps/miniapp` (`features/session/useSession.ts`)."""

        _, _, second, _ = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        opened = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()
        switched = (
            await client.post(
                SWITCH,
                headers=_bearer(opened["access_token"]),
                json={"patient_id": str(second.id)},
            )
        ).json()

        for body in (opened, switched):
            assert set(body) >= {
                "access_token",
                "refresh_token",
                "patient_id",
                "patient_name",
                "children",
                "web_url",
                "has_web_credentials",
            }
            for child in body["children"]:
                assert set(child) == {"patient_id", "name"}


class TestRepositoryForMailings:
    """Рассылки воркера называют ребёнка только в чате нескольких детей."""

    async def test_children_per_chat_counts_live_children(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, _, _, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        lone = await make_patient("Один Ребёнок")
        parent = await make_user(UserRole.PARENT)
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=lone.id)
        await telegram_repo.create_link(
            session,
            parent_id=parent.id,
            patient_id=lone.id,
            chat_id=CHAT_ID + 1,
            secret=telegram_repo.generate_binding_secret(),
        )

        assert await telegram_repo.children_per_chat(session, [CHAT_ID, CHAT_ID + 1]) == {
            CHAT_ID: 2,
            CHAT_ID + 1: 1,
        }

        await telegram_repo.revoke(session, opened_link_id(linked, 1))
        assert await telegram_repo.children_per_chat(session, [CHAT_ID]) == {CHAT_ID: 1}

    async def test_second_live_link_to_the_same_child_is_impossible(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, first, _, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        link = await session.get(TelegramAccount, opened_link_id(linked, 0))
        assert link is not None

        with pytest.raises(IntegrityError):
            async with session.begin_nested():
                await telegram_repo.create_link(
                    session,
                    parent_id=link.parent_id,
                    patient_id=first.id,
                    chat_id=CHAT_ID,
                    secret=telegram_repo.generate_binding_secret(),
                )


class TestReviewFindings:
    """Находки safety-review по ADR-0048 (05.10.2026)."""

    async def test_own_chat_code_of_another_adult_is_refused_and_not_burnt(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Код «подключить свой Telegram» не отдаёт ребёнка знакомому чужому Telegram."""

        # Бабушка уже знакома системе: ведёт внуков из своего чата.
        await _two_grandchildren(client, session, make_user, make_patient, auth_headers)
        # Мама другого ребёнка выпускает код своего чата — и он доходит до бабушки.
        mother = await make_user(UserRole.PARENT)
        other = await make_patient("Лейла Ахмедова")
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=other.id)
        issued = await client.post(
            f"/api/v1/patients/{other.id}/access-codes",
            headers=auth_headers(mother),
            json={"purpose": "own_chat"},
        )
        assert issued.status_code == 201, issued.text
        code = str(issued.json()["code"])

        response = await _activate(client, code)

        assert response.status_code == 409, response.text
        error = response.json()["error"]
        assert error["details"] == {"reason": "own_chat_other_adult"}
        assert "близкого" in error["message"]
        # Ни привязки чата к ребёнку, ни доступа бабушкиной учётной записи.
        assert (
            await telegram_repo.get_active_link_for_child(
                session, chat_id=CHAT_ID, patient_id=other.id
            )
            is None
        )
        assert await patients_repo.list_parent_ids(session, patient_id=other.id) == [mother.id]
        # Код не сожжён: мама подключает им свой телефон.
        own = await client.post(
            ACTIVATE,
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": CHAT_ID + 50,
                "telegram_user_id": CHAT_ID + 50,
                "first_name": "Мама",
            },
        )
        assert own.status_code == 201, own.text

    async def test_foreign_telegram_cannot_add_a_child_to_a_leading_chat(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Чат с привязками принимает ребёнка только от своего владельца."""

        doctor, _, _, _ = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        third = await make_patient("Лейла Иванова")
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=third.id)
        code = await _code(client, auth_headers, doctor, third)

        response = await client.post(
            ACTIVATE,
            headers=bot_headers(),
            json={
                "code": code,
                "chat_id": CHAT_ID,
                "telegram_user_id": CHAT_ID + 99,
                "first_name": "Чужой",
            },
        )

        assert response.status_code == 409, response.text
        assert response.json()["error"]["details"] == {"reason": "chat_taken"}
        assert (
            await telegram_repo.get_active_link_for_child(
                session, chat_id=CHAT_ID, patient_id=third.id
            )
            is None
        )

    async def test_bot_token_cannot_switch(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, _, second, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        token = (
            await client.post(
                "/api/v1/auth/bot/session",
                headers=bot_headers(),
                json={"link_id": linked[0]["link_id"], "secret": linked[0]["secret"]},
            )
        ).json()["access_token"]

        response = await client.post(
            SWITCH, headers=_bearer(token), json={"patient_id": str(second.id)}
        )

        assert response.status_code in (401, 403), response.text

    async def test_child_without_parent_access_is_not_offered(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Живая привязка без связи взрослого с ребёнком сессии не открывает."""

        _, first, second, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        link = await session.get(TelegramAccount, opened_link_id(linked, 1))
        assert link is not None
        # Доступ закрыт путём, который привязку не погасил.
        assert await patients_repo.unlink_parent(
            session, parent_id=link.parent_id, patient_id=second.id
        )

        opened = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()
        assert [child["patient_id"] for child in opened["children"]] == [str(first.id)]

        refused = await client.post(
            SWITCH, headers=_bearer(opened["access_token"]), json={"patient_id": str(second.id)}
        )
        assert refused.status_code == 404
        named = await client.post(
            INIT, json={"init_data": init_data(chat_id=CHAT_ID), "patient_id": str(second.id)}
        )
        assert named.status_code == 404

    async def test_refresh_after_switch_keeps_the_switched_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Mini App обновляет пару телом, и обновление не уводит к первому ребёнку."""

        _, first, second, linked = await _two_grandchildren(
            client, session, make_user, make_patient, auth_headers
        )
        opened = (await client.post(INIT, json={"init_data": init_data(chat_id=CHAT_ID)})).json()
        switched = (
            await client.post(
                SWITCH,
                headers=_bearer(opened["access_token"]),
                json={"patient_id": str(second.id)},
            )
        ).json()

        refreshed = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": switched["refresh_token"]}
        )

        assert refreshed.status_code == 200, refreshed.text
        body = refreshed.json()
        # Канал Mini App получает новую пару телом, без куки кабинета.
        assert body["refresh_token"]
        assert "refresh_token" not in refreshed.cookies
        claims = decode_token(body["access_token"], expected_type="access")
        assert claims["patient_scope"] == str(second.id)
        assert claims["tg"] == linked[1]["link_id"]
        assert claims["chan"] == "miniapp"
        own = await client.get(
            f"/api/v1/patients/{second.id}/overview", headers=_bearer(body["access_token"])
        )
        assert own.status_code == 200, own.text
        other = await client.get(
            f"/api/v1/patients/{first.id}/overview", headers=_bearer(body["access_token"])
        )
        assert other.status_code in (403, 404)

        # Отзыв привязки второго ребёнка гасит и обновление его пары.
        await telegram_repo.revoke(session, opened_link_id(linked, 1))
        dead = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
        )
        assert dead.status_code == 401

    async def test_password_reset_from_a_chat_of_two_accounts(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Сброс пароля из Mini App, когда чат ведёт детей от двух учётных записей.

        Цена из п. 2 ADR-0048: чат, подключённый кодом своего чата, кодом врача
        на второго ребёнка получает вторую учётную запись. Подпись запуска
        удостоверяет владельца, если хотя бы одна живая привязка чата — его.
        """

        mother = await make_user(UserRole.PARENT)
        doctor = await make_user(UserRole.DOCTOR)
        first = await make_patient("Аня Иванова")
        second = await make_patient("Тимур Иванов")
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=first.id)
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=second.id)
        own_chat = await client.post(
            f"/api/v1/patients/{first.id}/access-codes",
            headers=auth_headers(mother),
            json={"purpose": "own_chat"},
        )
        assert own_chat.status_code == 201, own_chat.text
        assert (await _activate(client, str(own_chat.json()["code"]))).status_code == 201
        second_link = await _activate(client, await _code(client, auth_headers, doctor, second))
        assert second_link.status_code == 201, second_link.text
        owners = {
            link.parent_id
            for link in await telegram_repo.list_active_links_by_chat(session, CHAT_ID)
        }
        assert len(owners) == 2 and mother.id in owners

        opened = await client.post(
            INIT,
            json={"init_data": init_data(chat_id=CHAT_ID), "patient_id": str(first.id)},
        )
        assert opened.status_code == 200, opened.text
        response = await client.post(
            "/api/v1/users/me/credentials/reset",
            headers=_bearer(opened.json()["access_token"]),
            json={
                "password": "синий чайник на подоконнике",
                "init_data": init_data(chat_id=CHAT_ID),
            },
        )

        assert response.status_code == 204, response.text
