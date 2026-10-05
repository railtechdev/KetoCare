"""Один чат — несколько детей (ADR-0048).

Главное, что здесь проверяется: запись уходит ВЫБРАННОМУ ребёнку — с секретом
его привязки, — выбор закрывает начатый сценарий, и эхо называет ребёнка, когда
их двое. Хранилище настоящее (`BindingStore`), подделан только Redis.
"""

from __future__ import annotations

import json
import uuid

import pytest
from aiogram.fsm.context import FSMContext

from bot import keyboards, texts
from bot.api import LinkVerified
from bot.handlers import fallback, scenarios, start
from bot.storage import Binding, BindingStore

from .conftest import CHAT_ID, LINK_ID, PATIENT_ID, SECRET, FakeStore, put_binding
from .test_scenarios import SETTINGS, FakeCallback, FakeMessage, answer_when_now

SECOND_PATIENT = uuid.UUID("33333333-3333-3333-3333-333333333333")
SECOND_LINK = uuid.UUID("44444444-4444-4444-4444-444444444444")
SECOND_SECRET = "second-binding-secret"

ANYA = Binding(
    link_id=LINK_ID,
    secret=SECRET,
    patient_id=PATIENT_ID,
    patient_name="Аня Иванова",
    patient_first_name="Аня",
)
TIMUR = Binding(
    link_id=SECOND_LINK,
    secret=SECOND_SECRET,
    patient_id=SECOND_PATIENT,
    patient_name="Тимур Иванов",
    patient_first_name="Тимур",
)


@pytest.fixture
def two_children() -> BindingStore:
    store = FakeStore()
    put_binding(store, CHAT_ID, ANYA)
    put_binding(store, CHAT_ID, TIMUR)
    return store


def _button_texts(markup) -> list[str]:
    rows = getattr(markup, "keyboard", None) or getattr(markup, "inline_keyboard", [])
    return [button.text for row in rows for button in row]


class TestStore:
    @pytest.mark.asyncio
    async def test_put_adds_a_child_and_selects_it(self):
        store = FakeStore()
        await store.put(CHAT_ID, ANYA)
        await store.put(CHAT_ID, TIMUR)

        assert [b.first_name for b in await store.all(CHAT_ID)] == ["Аня", "Тимур"]
        selected = await store.get(CHAT_ID)
        assert selected is not None and selected.patient_id == SECOND_PATIENT
        assert selected.secret == SECOND_SECRET

    @pytest.mark.asyncio
    async def test_children_keep_the_order_they_were_linked_in(self):
        """Порядок — как в Mini App (по времени привязки), а не по алфавиту."""

        store = FakeStore()
        await store.put(CHAT_ID, TIMUR)
        await store.put(CHAT_ID, ANYA)

        assert [b.first_name for b in await store.all(CHAT_ID)] == ["Тимур", "Аня"]

    @pytest.mark.asyncio
    async def test_select_only_a_child_of_this_chat(self, two_children):
        assert await two_children.select(CHAT_ID, PATIENT_ID) == ANYA
        assert await two_children.get(CHAT_ID) == ANYA
        assert await two_children.select(CHAT_ID, uuid.uuid4()) is None
        assert await two_children.get(CHAT_ID) == ANYA, "чужой ребёнок выбор не меняет"

    @pytest.mark.asyncio
    async def test_forget_keeps_the_other_child(self, two_children):
        remaining = await two_children.forget(CHAT_ID, SECOND_PATIENT)

        assert remaining == ANYA
        assert await two_children.get(CHAT_ID) == ANYA
        assert await two_children.forget(CHAT_ID, PATIENT_ID) is None
        assert await two_children.get(CHAT_ID) is None

    @pytest.mark.asyncio
    async def test_binding_of_the_old_layout_is_carried_over(self):
        """Обновление бота не отвязывает семьи: прежний ключ переносится."""

        store = FakeStore()
        redis = store._redis
        redis.hashes[f"bot:binding:{CHAT_ID}"] = {  # type: ignore[attr-defined]
            "link_id": str(LINK_ID),
            "secret": SECRET,
            "patient_id": str(PATIENT_ID),
            "patient_name": "Аня Иванова",
        }

        binding = await store.get(CHAT_ID)

        assert binding is not None and binding.secret == SECRET
        assert binding.first_name == "Аня", "имя выводится из «Имя и фамилия»"
        stored = redis.hashes[f"bot:bindings:{CHAT_ID}"][str(PATIENT_ID)]  # type: ignore[attr-defined]
        assert json.loads(stored)["secret"] == SECRET
        # Прежний ключ остаётся на один выпуск — для отката бота.
        assert redis.hashes[f"bot:binding:{CHAT_ID}"]["secret"] == SECRET  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_old_layout_never_overwrites_a_newer_record(self):
        """Прежний ключ с устаревшим секретом не затирает свежую привязку."""

        store = FakeStore()
        await store.put(CHAT_ID, ANYA)
        redis = store._redis
        redis.hashes[f"bot:binding:{CHAT_ID}"] = {  # type: ignore[attr-defined]
            "link_id": str(uuid.uuid4()),
            "secret": "stale-secret",
            "patient_id": str(PATIENT_ID),
            "patient_name": "Аня Иванова",
        }

        binding = await store.get(CHAT_ID)

        assert binding is not None and binding.secret == SECRET

    @pytest.mark.asyncio
    async def test_put_keeps_the_old_layout_for_a_rollback(self):
        store = FakeStore()
        await store.put(CHAT_ID, ANYA)
        await store.put(CHAT_ID, TIMUR)

        legacy = store._redis.hashes[f"bot:binding:{CHAT_ID}"]  # type: ignore[attr-defined]
        assert legacy == {
            "link_id": str(SECOND_LINK),
            "secret": SECOND_SECRET,
            "patient_id": str(SECOND_PATIENT),
            "patient_name": "Тимур Иванов",
        }

    @pytest.mark.asyncio
    async def test_forgotten_child_is_not_revived_from_the_old_layout(self):
        store = FakeStore()
        await store.put(CHAT_ID, ANYA)
        await store.put(CHAT_ID, TIMUR)

        remaining = await store.forget(CHAT_ID, SECOND_PATIENT, SECOND_LINK)

        assert remaining is not None and remaining.patient_id == PATIENT_ID
        assert [b.patient_id for b in await store.all(CHAT_ID)] == [PATIENT_ID]
        legacy = store._redis.hashes[f"bot:binding:{CHAT_ID}"]  # type: ignore[attr-defined]
        assert legacy["patient_id"] == str(PATIENT_ID), "откатанный бот видит оставшегося"

        assert await store.forget(CHAT_ID, PATIENT_ID, LINK_ID) is None
        assert await store.all(CHAT_ID) == []
        assert f"bot:binding:{CHAT_ID}" not in store._redis.hashes  # type: ignore[attr-defined]


class TestMenu:
    @pytest.mark.asyncio
    async def test_one_child_has_no_switch(self, linked_store):
        message = FakeMessage(text="/start")
        await start.start_without_code(message, _state(), linked_store, SETTINGS)

        assert not any(
            text.startswith(texts.BTN_CHILD_PREFIX) for text in _button_texts(message.last_markup)
        )

    @pytest.mark.asyncio
    async def test_two_children_show_who_is_selected(self, two_children):
        message = FakeMessage(text="/start")
        await start.start_without_code(message, _state(), two_children, SETTINGS)

        assert "Тимур" in message.last and "Аня" in message.last
        assert texts.BTN_CHILD.format(name="Тимур") in _button_texts(message.last_markup)


class TestSwitch:
    @pytest.mark.asyncio
    async def test_button_lists_the_children(self, two_children):
        message = FakeMessage(text=texts.BTN_CHILD.format(name="Тимур"))
        await start.child_menu(message, _state(), two_children, SETTINGS)

        assert message.last == texts.CHILD_ASK.format(active="Тимур")
        assert _button_texts(message.last_markup) == ["Аня", "✓ Тимур"]

    @pytest.mark.asyncio
    async def test_button_with_one_child_explains_how_to_add(self, linked_store):
        message = FakeMessage(text=texts.BTN_CHILD.format(name="Амина"))
        await start.child_menu(message, _state(), linked_store, SETTINGS)

        assert "код доступа" in message.last

    @pytest.mark.asyncio
    async def test_choice_selects_and_closes_the_open_scenario(self, two_children):
        state = _state()
        await state.set_state(scenarios.Weight.value)
        callback = FakeCallback(data=f"{keyboards.CHILD_PREFIX}{PATIENT_ID}")

        await start.child_chosen(callback, state, two_children, SETTINGS)

        assert await two_children.get(CHAT_ID) == ANYA
        assert await state.get_state() is None, "запись, начатая про другого, не продолжится"
        assert callback.message.last == texts.CHILD_CHOSEN.format(name="Аня")
        assert texts.BTN_CHILD.format(name="Аня") in _button_texts(callback.message.last_markup)

    @pytest.mark.asyncio
    async def test_choice_of_a_child_no_longer_here(self, two_children):
        callback = FakeCallback(data=f"{keyboards.CHILD_PREFIX}{uuid.uuid4()}")

        await start.child_chosen(callback, _state(), two_children, SETTINGS)

        assert callback.message.last == texts.CHILD_GONE
        assert await two_children.get(CHAT_ID) == TIMUR


class TestWritesGoToTheSelectedChild:
    @pytest.mark.asyncio
    async def test_weight_goes_to_the_selected_child_and_the_echo_names_it(self, api, two_children):
        state = _state()
        await two_children.select(CHAT_ID, PATIENT_ID)
        start_message = FakeMessage(text=texts.BTN_WEIGHT)
        await scenarios.weight_start(start_message, state, two_children)
        assert start_message.last.startswith("👶 Аня\n"), "до ввода видно, чей дневник"

        message = FakeMessage(text="18.4")
        await scenarios.weight_value(message, state, api, two_children, SETTINGS)
        await answer_when_now(message, state, api, two_children)

        sent = api.logs[-1]
        assert sent["patient_id"] == PATIENT_ID
        assert sent["link_id"] == LINK_ID and sent["secret"] == SECRET
        assert message.last.startswith("Записано ✓ Аня: ")

    @pytest.mark.asyncio
    async def test_after_switching_the_next_write_goes_to_the_other(self, api, two_children):
        await two_children.select(CHAT_ID, SECOND_PATIENT)
        state = _state()
        await scenarios.weight_start(FakeMessage(text=texts.BTN_WEIGHT), state, two_children)

        message = FakeMessage(text="18.4")
        await scenarios.weight_value(message, state, api, two_children, SETTINGS)
        await answer_when_now(message, state, api, two_children)

        assert api.logs[-1]["patient_id"] == SECOND_PATIENT
        assert api.logs[-1]["secret"] == SECOND_SECRET
        assert message.last.startswith("Записано ✓ Тимур: ")

    @pytest.mark.asyncio
    async def test_one_child_echo_is_unchanged(self, api, linked_store):
        state = _state()
        await state.set_state(scenarios.Weight.value)
        message = FakeMessage(text="18.4")

        await scenarios.weight_value(message, state, api, linked_store, SETTINGS)
        await answer_when_now(message, state, api, linked_store)

        assert message.last.startswith("Записано ✓ Вес")

    @pytest.mark.asyncio
    async def test_revoking_one_child_keeps_the_other(self, api, two_children):
        from bot.api import LinkRevokedError

        await two_children.select(CHAT_ID, SECOND_PATIENT)
        api.log_error = LinkRevokedError("unauthorized", "отозвана", 401)
        state = _state()
        await scenarios.weight_start(FakeMessage(text=texts.BTN_WEIGHT), state, two_children)
        message = FakeMessage(text="18.4")

        await scenarios.weight_value(message, state, api, two_children, SETTINGS)
        await answer_when_now(message, state, api, two_children)

        assert message.last == texts.LINK_REVOKED_ONE.format(revoked="Тимур", active="Аня")
        assert await two_children.get(CHAT_ID) == ANYA


class TestScenarioKeepsItsChild:
    """Запись уходит ребёнку, про которого сценарий начат, — не выбранному сейчас.

    Находка ревью ADR-0048: выбранный ребёнок меняется и мимо кнопки «👶» —
    кодом другого ребёнка, присланным текстом посреди сценария, — а aiogram
    обрабатывает обновления параллельно, и переключение может обогнать отправку.
    """

    @pytest.mark.asyncio
    async def test_code_for_another_child_mid_scenario_writes_nothing_to_it(self, api, store):
        await store.put(CHAT_ID, ANYA)
        state = _state()
        await scenarios.weight_start(FakeMessage(text=texts.BTN_WEIGHT), state, store)
        typed = FakeMessage(text="18.4")
        await scenarios.weight_value(typed, state, api, store, SETTINGS)
        assert typed.last == texts.WHEN_ASK

        # Посреди шага «когда» семья присылает текстом код второго ребёнка.
        api.verified = LinkVerified(
            link_id=SECOND_LINK,
            patient_id=SECOND_PATIENT,
            patient_name="Тимур Иванов",
            secret=SECOND_SECRET,
            web_url="https://app.example",
            has_web_credentials=False,
            patient_first_name="Тимур",
        )
        await fallback.unknown(
            FakeMessage(text="ABCD 2345"), state=state, api=api, store=store, settings=SETTINGS
        )
        assert (await store.get(CHAT_ID)).patient_id == SECOND_PATIENT  # type: ignore[union-attr]
        assert await state.get_state() is None, "код закрыл начатый сценарий"

        # Старая кнопка «Сейчас» всё равно нажата (обработчик вызывается напрямую,
        # мимо фильтра состояния, — худший случай).
        await answer_when_now(typed, state, api, store)

        assert api.logs == [], "ничего не записано — ни Тимуру, ни Ане"
        assert typed.last == texts.SCENARIO_CHILD_UNKNOWN

    @pytest.mark.asyncio
    async def test_switch_racing_the_submit_does_not_redirect_the_write(self, api, two_children):
        await two_children.select(CHAT_ID, PATIENT_ID)
        state = _state()
        await scenarios.weight_start(FakeMessage(text=texts.BTN_WEIGHT), state, two_children)
        message = FakeMessage(text="18.4")
        await scenarios.weight_value(message, state, api, two_children, SETTINGS)

        # Переключение пришло параллельным обновлением и состояние не тронуло.
        await two_children.select(CHAT_ID, SECOND_PATIENT)
        await answer_when_now(message, state, api, two_children)

        sent = api.logs[-1]
        assert sent["patient_id"] == PATIENT_ID
        assert sent["link_id"] == LINK_ID and sent["secret"] == SECRET
        assert message.last.startswith("Записано ✓ Аня: ")

    @pytest.mark.asyncio
    async def test_child_gone_mid_scenario_is_refused(self, api, two_children):
        await two_children.select(CHAT_ID, SECOND_PATIENT)
        state = _state()
        await scenarios.weight_start(FakeMessage(text=texts.BTN_WEIGHT), state, two_children)
        message = FakeMessage(text="18.4")
        await scenarios.weight_value(message, state, api, two_children, SETTINGS)

        await two_children.forget(CHAT_ID, SECOND_PATIENT)
        await answer_when_now(message, state, api, two_children)

        assert api.logs == []
        assert message.last == texts.SCENARIO_CHILD_GONE
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_meal_confirm_goes_to_the_scenario_child(self, api, two_children):
        await two_children.select(CHAT_ID, PATIENT_ID)
        state = _state()
        await scenarios.meal_start(
            FakeMessage(text=texts.BTN_MEAL), state, api, two_children, SETTINGS
        )
        await state.set_state(scenarios.Meal.confirm)
        await state.update_data(meal_text="каша", meal_job_id=str(uuid.uuid4()))

        await two_children.select(CHAT_ID, SECOND_PATIENT)
        callback = FakeCallback(data=keyboards.CONFIRM_DATA)
        await scenarios.meal_text_confirm(callback, state, api, two_children, SETTINGS)

        assert api.logs[-1]["patient_id"] == PATIENT_ID
        assert api.logs[-1]["secret"] == SECRET

    @pytest.mark.asyncio
    async def test_scenario_from_before_the_update_with_two_children_is_refused(
        self, api, two_children
    ):
        """Сценарий без отметки начат до обновления; угадывать ребёнка нельзя."""

        state = _state()
        await state.set_state(scenarios.Weight.value)
        message = FakeMessage(text="18.4")

        await scenarios.weight_value(message, state, api, two_children, SETTINGS)

        assert api.logs == []
        assert message.last == texts.SCENARIO_CHILD_UNKNOWN


class TestSecondCode:
    @pytest.mark.asyncio
    async def test_second_code_adds_the_child_and_says_how_to_switch(self, api, linked_store):
        api.verified = LinkVerified(
            link_id=SECOND_LINK,
            patient_id=SECOND_PATIENT,
            patient_name="Тимур Иванов",
            secret=SECOND_SECRET,
            web_url="https://app.example",
            has_web_credentials=False,
            patient_first_name="Тимур",
        )
        message = FakeMessage()

        await start._link(message, api=api, store=linked_store, settings=SETTINGS, code="ABCD2345")

        assert {b.patient_id for b in await linked_store.all(CHAT_ID)} == {
            PATIENT_ID,
            SECOND_PATIENT,
        }
        assert (await linked_store.get(CHAT_ID)).patient_id == SECOND_PATIENT  # type: ignore[union-attr]
        assert "Тимур Иванов" in message.last
        assert texts.BTN_CHILD_PREFIX in message.last
        assert texts.BTN_CHILD.format(name="Тимур") in _button_texts(message.last_markup)


def _state() -> FSMContext:
    from aiogram.fsm.storage.base import StorageKey
    from aiogram.fsm.storage.memory import MemoryStorage

    return FSMContext(
        storage=MemoryStorage(), key=StorageKey(bot_id=1, chat_id=CHAT_ID, user_id=CHAT_ID)
    )
