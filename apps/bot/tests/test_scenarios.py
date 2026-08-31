"""Сценарии ввода и привязка (раздел 7 ТЗ).

Обработчики вызываются напрямую с поддельными Message/CallbackQuery: проверяется
наша логика — валидация, переходы состояний, форма запроса к API, поведение при
отзыве привязки, — а не сеть Telegram.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.fsm.storage.memory import MemoryStorage

from bot import keyboards, texts
from bot.api import BotApiError, LinkRevokedError
from bot.config import BotSettings
from bot.handlers import fallback, scenarios, start

from .conftest import CHAT_ID, LINK_ID, PATIENT_ID, PATIENT_NAME, SECRET

# Настройки нужны шагу «когда»: время вводится по местным часам семьи.
SETTINGS = BotSettings(bot_token="t", bot_api_token="s")


@dataclass
class FakeChat:
    id: int = CHAT_ID


@dataclass
class FakeMessage:
    """Минимальный Message: только то, чем пользуются обработчики."""

    text: str | None = None
    chat: FakeChat = field(default_factory=FakeChat)
    answers: list[tuple[str, Any]] = field(default_factory=list)

    async def answer(self, text: str, reply_markup: Any = None, **_: Any) -> None:
        self.answers.append((text, reply_markup))

    @property
    def last(self) -> str:
        assert self.answers, "обработчик ничего не ответил"
        return self.answers[-1][0]


@dataclass
class FakeCallback:
    data: str
    message: FakeMessage = field(default_factory=FakeMessage)
    answered: bool = False

    async def answer(self, *_: Any, **__: Any) -> None:
        self.answered = True


async def answer_when_now(message: FakeMessage, state: FSMContext, api: Any, store: Any) -> None:
    """Проходит шаг «когда это было», отвечая «Сейчас».

    Шаг общий для всех сценариев: бот ставил моментом события момент отправки,
    и вечерняя запись утреннего замера сдвигала его на десять часов.
    """

    assert message.last == texts.WHEN_ASK, "перед отправкой бот спрашивает о времени"
    callback = FakeCallback(data=keyboards.WHEN_NOW_DATA, message=message)
    await scenarios.when_now(callback, state, api, store)


@pytest.fixture
def state() -> FSMContext:
    return FSMContext(
        storage=MemoryStorage(),
        key=StorageKey(bot_id=1, chat_id=CHAT_ID, user_id=CHAT_ID),
    )


class TestLinking:
    @pytest.mark.asyncio
    async def test_start_with_code_stores_binding(self, api, store):
        message = FakeMessage(text="/start ABCD2345")

        await start._link(message, api=api, store=store, code="ABCD2345")

        assert PATIENT_NAME in message.last
        binding = await store.get(CHAT_ID)
        assert binding is not None
        assert binding.secret == SECRET, "секрет обязан сохраниться: восстановить его нельзя"

    @pytest.mark.asyncio
    async def test_invalid_code_explains_where_to_get_a_new_one(self, api, store):
        api.verify_error = BotApiError("not_found", "нет", 404)
        message = FakeMessage()

        await start._link(message, api=api, store=store, code="ZZZZZZZZ")

        assert "15 минут" in message.last
        assert await store.get(CHAT_ID) is None

    @pytest.mark.asyncio
    async def test_busy_chat_tells_to_unlink_first(self, api, store):
        api.verify_error = BotApiError("conflict", "занято", 409)
        message = FakeMessage()

        await start._link(message, api=api, store=store, code="ABCD2345")

        assert message.last == texts.LINK_CHAT_BUSY

    @pytest.mark.asyncio
    async def test_bare_code_is_treated_as_a_code_not_as_chatter(self, api, store):
        """Родитель с компьютера переписывает код руками, а не жмёт ссылку."""

        message = FakeMessage(text="ABCD2345")

        await fallback.unknown(message, api=api, store=store)

        assert PATIENT_NAME in message.last
        assert await store.get(CHAT_ID) is not None

    @pytest.mark.asyncio
    async def test_chatter_gets_the_standard_answer(self, api, linked_store):
        """Раздел 7.5: бот не поддерживает беседу и не отвечает на вопросы."""

        message = FakeMessage(text="а какое соотношение у моего ребёнка?")

        await fallback.unknown(message, api=api, store=linked_store)

        assert message.last == texts.UNKNOWN_INPUT

    def test_code_shape(self):
        assert start.looks_like_code("ABCD2345")
        assert start.looks_like_code("  ABCD2345 ")
        assert not start.looks_like_code("ABCD234")
        assert not start.looks_like_code("ABCD-345")


class TestKetones:
    @pytest.mark.asyncio
    async def test_requires_binding(self, store, state):
        message = FakeMessage()

        await scenarios.ketones_start(message, state, store)

        assert message.last == texts.NOT_LINKED
        assert await state.get_state() is None, "без привязки сценарий не начинается"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("raw", ["12.1", "-1", "100"])
    async def test_out_of_range_is_re_asked(self, state, raw):
        message = FakeMessage(text=raw)
        await state.set_state(scenarios.Ketones.value)

        await scenarios.ketones_value(message, state)

        assert message.last == texts.KETONES_OUT_OF_RANGE
        assert await state.get_state() == scenarios.Ketones.value.state

    @pytest.mark.asyncio
    async def test_not_a_number_is_re_asked(self, state):
        message = FakeMessage(text="много")
        await state.set_state(scenarios.Ketones.value)

        await scenarios.ketones_value(message, state)

        assert message.last == texts.KETONES_NOT_A_NUMBER

    @pytest.mark.asyncio
    async def test_comma_is_accepted_as_a_separator(self, state):
        message = FakeMessage(text="3,2")
        await state.set_state(scenarios.Ketones.value)

        await scenarios.ketones_value(message, state)

        assert (await state.get_data())["value"] == "3.2"

    @pytest.mark.asyncio
    async def test_full_flow_sends_value_and_method(self, api, linked_store, state):
        message = FakeMessage(text="3.2")
        await state.set_state(scenarios.Ketones.value)
        await scenarios.ketones_value(message, state)

        callback = FakeCallback(data=f"{keyboards.KETONE_METHOD_PREFIX}blood")
        await scenarios.ketones_method(callback, state, api, linked_store)
        await answer_when_now(callback.message, state, api, linked_store)

        assert len(api.logs) == 1
        sent = api.logs[0]
        assert sent["kind"] == "ketones"
        assert sent["payload"]["value"] == "3.2"
        assert sent["payload"]["method"] == "blood"
        assert sent["patient_id"] == PATIENT_ID
        assert sent["link_id"] == LINK_ID
        assert "occurred_at" in sent["payload"], "время ставит бот, а не сервер"
        assert "source" not in sent["payload"], "канал проставляет сервер по токену"
        assert callback.message.last == texts.SAVED
        assert await state.get_state() is None


class TestWeight:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("raw", ["1.9", "151", "0"])
    async def test_out_of_range_is_re_asked(self, api, linked_store, state, raw):
        message = FakeMessage(text=raw)
        await state.set_state(scenarios.Weight.value)

        await scenarios.weight_value(message, state, api, linked_store)

        assert message.last == texts.WEIGHT_OUT_OF_RANGE
        assert not api.logs

    @pytest.mark.asyncio
    async def test_valid_value_is_sent(self, api, linked_store, state):
        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)

        await scenarios.weight_value(message, state, api, linked_store)
        await answer_when_now(message, state, api, linked_store)

        assert api.logs[0]["kind"] == "weight"
        assert api.logs[0]["payload"]["weight_kg"] == "18.4"
        assert message.last == texts.SAVED


class TestWellbeing:
    @pytest.mark.asyncio
    async def test_symptom_then_description(self, api, linked_store, state):
        first = FakeMessage(text="вялость")
        await state.set_state(scenarios.Wellbeing.symptom)
        await scenarios.wellbeing_symptom(first, state)

        second = FakeMessage(text="после обеда")
        await scenarios.wellbeing_note(second, state, api, linked_store)
        await answer_when_now(second, state, api, linked_store)

        payload = api.logs[0]["payload"]
        assert api.logs[0]["kind"] == "side-effects"
        assert payload["symptom"] == "вялость"
        assert payload["description"] == "после обеда"

    @pytest.mark.asyncio
    async def test_description_may_be_skipped(self, api, linked_store, state):
        first = FakeMessage(text="вялость")
        await state.set_state(scenarios.Wellbeing.symptom)
        await scenarios.wellbeing_symptom(first, state)

        callback = FakeCallback(data=keyboards.WELLBEING_SKIP_DATA)
        await scenarios.wellbeing_skip_note(callback, state, api, linked_store)
        await answer_when_now(callback.message, state, api, linked_store)

        assert "description" not in api.logs[0]["payload"]

    @pytest.mark.asyncio
    async def test_too_long_symptom_is_re_asked(self, state):
        message = FakeMessage(text="я" * (scenarios.SYMPTOM_MAX_LENGTH + 1))
        await state.set_state(scenarios.Wellbeing.symptom)

        await scenarios.wellbeing_symptom(message, state)

        assert "255" in message.last
        assert await state.get_state() == scenarios.Wellbeing.symptom.state


class TestCancelAndFailures:
    @pytest.mark.asyncio
    async def test_cancel_clears_state(self, state):
        await state.set_state(scenarios.Ketones.value)
        callback = FakeCallback(data=keyboards.CANCEL_DATA)

        await scenarios.cancel(callback, state)

        assert await state.get_state() is None
        assert callback.message.last == texts.CANCELLED
        assert callback.answered, "инлайновую кнопку надо погасить, иначе она крутится"

    @pytest.mark.asyncio
    async def test_revoked_binding_is_forgotten_locally(self, api, linked_store, state):
        """Отозванная привязка не должна оставаться у бота.

        Иначе он предъявлял бы мёртвый секрет на каждом сообщении, а семья
        видела бы одну и ту же ошибку и не понимала, что делать.
        """

        api.log_error = LinkRevokedError("unauthorized", "отозвана", 401)
        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)

        await scenarios.weight_value(message, state, api, linked_store)
        await answer_when_now(message, state, api, linked_store)

        assert message.last == texts.LINK_REVOKED
        assert await linked_store.get(CHAT_ID) is None
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_api_failure_keeps_binding(self, api, linked_store, state):
        """Сбой связи — не повод отвязывать чат: секрет по-прежнему верен."""

        api.log_error = BotApiError("internal", "сбой", 500)
        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)

        await scenarios.weight_value(message, state, api, linked_store)
        await answer_when_now(message, state, api, linked_store)

        assert message.last == texts.API_UNAVAILABLE
        assert await linked_store.get(CHAT_ID) is not None


class TestWiring:
    def test_fallback_router_is_last(self, dispatcher):
        """Порядок роутеров — часть поведения: fallback ловит всё подряд."""

        names = [router.name for router in dispatcher.sub_routers]
        assert names[-1] == "fallback"
        assert names == ["start", "scenarios", "fallback"]

    def test_main_menu_has_every_scenario_of_the_spec(self):
        """Раздел 7.2 перечисляет семь кнопок — состав меню проверяется, а не подразумевается."""

        labels = {button.text for row in keyboards.MAIN_MENU.keyboard for button in row}
        assert labels == {
            texts.BTN_SEIZURE,
            texts.BTN_KETONES,
            texts.BTN_WEIGHT,
            texts.BTN_MEAL,
            texts.BTN_MEDICATION,
            texts.BTN_WELLBEING,
            texts.BTN_APP,
        }


class TestEventTimeStep:
    """Время события задаёт семья, а не момент отправки.

    Родитель, записывающий вечером утренний замер, сдвигал его на десять часов —
    а по времени замеров врач судит о динамике.
    """

    @pytest.mark.asyncio
    async def test_manual_time_is_sent_instead_of_now(self, api, linked_store, state):
        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)
        await scenarios.weight_value(message, state, api, linked_store)

        callback = FakeCallback(data=keyboards.WHEN_MANUAL_DATA, message=message)
        await scenarios.when_manual(callback, state)
        assert message.last == texts.WHEN_ASK_MANUAL

        typed = FakeMessage(text="07:30")
        await scenarios.when_typed(typed, state, api, linked_store, SETTINGS)

        assert len(api.logs) == 1
        occurred = api.logs[0]["payload"]["occurred_at"]
        # 07:30 по Ташкенту — 02:30 UTC: сдвиг применён, а не проигнорирован.
        assert occurred.endswith("+00:00") or occurred.endswith("Z")
        assert "T02:30" in occurred
        assert typed.last == texts.SAVED

    @pytest.mark.asyncio
    async def test_bad_time_is_re_asked_without_sending(self, api, linked_store, state):
        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)
        await scenarios.weight_value(message, state, api, linked_store)
        await scenarios.when_manual(
            FakeCallback(data=keyboards.WHEN_MANUAL_DATA, message=message), state
        )

        typed = FakeMessage(text="вчера утром")
        await scenarios.when_typed(typed, state, api, linked_store, SETTINGS)

        assert typed.last == texts.WHEN_BAD_FORMAT
        assert not api.logs, "до разбора времени запись не уходит"
        assert await state.get_state() == scenarios.When.manual.state

    @pytest.mark.asyncio
    async def test_future_time_gets_its_own_explanation(self, api, linked_store, state):
        """«Неверный формат» на будущее время отправило бы исправлять верное."""

        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)
        await scenarios.weight_value(message, state, api, linked_store)
        await scenarios.when_manual(
            FakeCallback(data=keyboards.WHEN_MANUAL_DATA, message=message), state
        )

        tomorrow = datetime.now(ZoneInfo(SETTINGS.tz)) + timedelta(days=1)
        typed = FakeMessage(text=tomorrow.strftime("%d.%m %H:%M"))
        await scenarios.when_typed(typed, state, api, linked_store, SETTINGS)

        assert typed.last == texts.WHEN_IN_FUTURE
        assert not api.logs


class TestMeal:
    """Кнопка «Еда» была, обработчика не было: нажатие уходило в «не понял».

    Свободного текста здесь нет до этапа 4: разбор «съел кашу с маслом» — это
    `POST /ai/parse`, а придуманная ботом еда попадёт в итоги дня наравне с
    настоящей.
    """

    MENU = {
        "items": [
            {
                "id": "item-1",
                "meal_slot": "breakfast",
                "title": "Омлет с маслом",
                "eaten": False,
            },
            {
                "id": "item-2",
                "meal_slot": "dinner",
                "title": "Курица с брокколи",
                "eaten": True,
            },
        ]
    }

    @pytest.mark.asyncio
    async def test_offers_only_what_is_not_eaten_yet(self, api, linked_store, state):
        api.menu = self.MENU
        message = FakeMessage(text=texts.BTN_MEAL)

        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEAL_ASK
        buttons = [button.text for row in message.answers[-1][1].inline_keyboard for button in row]
        assert "Завтрак: Омлет с маслом" in buttons
        assert all("Курица" not in text for text in buttons), "съеденное не предлагается"

    @pytest.mark.asyncio
    async def test_marks_the_chosen_item(self, api, linked_store, state):
        api.menu = self.MENU
        message = FakeMessage(text=texts.BTN_MEAL)
        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        callback = FakeCallback(data=f"{keyboards.MEAL_ITEM_PREFIX}item-1", message=message)
        await scenarios.meal_mark(callback, state, api, linked_store)

        assert api.eaten == ["item-1"]
        assert message.last == texts.MEAL_MARKED
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_no_menu_explains_what_to_do(self, api, linked_store, state):
        """Отсутствие меню — обычное состояние, а не сбой."""

        api.menu = None
        message = FakeMessage(text=texts.BTN_MEAL)

        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEAL_NO_MENU
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_all_eaten_says_so(self, api, linked_store, state):
        api.menu = {"items": [{**self.MENU["items"][1]}]}
        message = FakeMessage(text=texts.BTN_MEAL)

        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEAL_ALL_EATEN

    @pytest.mark.asyncio
    async def test_revoked_binding_is_forgotten(self, api, linked_store, state):
        api.menu_error = LinkRevokedError("unauthorized", "отозвана", 401)
        message = FakeMessage(text=texts.BTN_MEAL)

        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.LINK_REVOKED
        assert await linked_store.get(CHAT_ID) is None


class TestMedication:
    """Схему терапии ведёт врач, препараты ребёнку даёт семья.

    Кнопка была, обработчика не было: отметить приём из чата было нельзя, и
    отмечали его где угодно, только не в системе.
    """

    MEDS = [
        {"id": "med-1", "drug_name": "Депакин", "dose": "300 мг"},
        {"id": "med-2", "drug_name": "Топамакс", "dose": "50 мг"},
    ]

    @pytest.mark.asyncio
    async def test_offers_the_schedule_of_the_day(self, api, linked_store, state):
        api.medications = self.MEDS
        message = FakeMessage(text=texts.BTN_MEDICATION)

        await scenarios.medication_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEDICATION_ASK
        buttons = [button.text for row in message.answers[-1][1].inline_keyboard for button in row]
        # Список, а не ввод названия: препарат называется так, как его записал
        # врач, и опечатка семьи сделала бы запись несопоставимой со схемой.
        assert "Депакин — 300 мг" in buttons

    @pytest.mark.asyncio
    async def test_choice_asks_when_and_then_sends(self, api, linked_store, state):
        api.medications = self.MEDS
        message = FakeMessage(text=texts.BTN_MEDICATION)
        await scenarios.medication_start(message, state, api, linked_store, SETTINGS)

        callback = FakeCallback(data=f"{keyboards.MEDICATION_PREFIX}med-1", message=message)
        await scenarios.medication_choice(callback, state)

        # Приём препарата часто отмечают позже, чем он был, — время спрашивается
        # тем же шагом, что и у замеров.
        await answer_when_now(message, state, api, linked_store)

        assert api.logs[0]["kind"] == "medications"
        assert api.logs[0]["payload"]["medication_id"] == "med-1"
        assert api.logs[0]["payload"]["taken"] is True

    @pytest.mark.asyncio
    async def test_empty_schedule_explains_who_fills_it(self, api, linked_store, state):
        api.medications = []
        message = FakeMessage(text=texts.BTN_MEDICATION)

        await scenarios.medication_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEDICATION_NONE
        assert await state.get_state() is None
