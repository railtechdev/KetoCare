"""Сценарий «Приступ» в боте (раздел 7.3 ТЗ, вопрос 23, ADR-0020).

Самое важное событие дневника и единственное, где длительность приходит со слов.
Поэтому проверяется не «сценарий проходит», а то, что записывается: интервал
остаётся интервалом, точное число — числом, и одно не превращается в другое.
"""

from __future__ import annotations

import uuid

import pytest

from bot import keyboards, texts
from bot.api import BotApiError, LinkRevokedError
from bot.config import BotSettings
from bot.handlers import scenarios

from .test_scenarios import FakeCallback, FakeMessage, answer_when_now

SETTINGS = BotSettings(bot_token="t", bot_api_token="s", tz="Asia/Tashkent")

TYPE_ID = str(uuid.uuid4())
OPTION_ID = str(uuid.uuid4())

# Форма — как у настоящего ответа `/dictionaries/seizure-types`
# (`DictionaryEntryRead`: id, name_ru, sort). Придуманная форма фикстуры уже
# один раз стоила рабочего сценария: бот читал `name`, API отдавал `name_ru`,
# и обработчик падал на KeyError у семьи, а тесты были зелёными.
TYPES = [{"id": TYPE_ID, "name_ru": "Тонико-клонический", "sort": 0}]
# Шкала анкеты: границы 5, 10 и 30 минут — операциональное определение
# эпилептического статуса ILAE (Trinka, 2015).
DURATIONS = [
    {"id": str(uuid.uuid4()), "code": "dur_under_1min", "name_ru": "Меньше 1 минуты"},
    {"id": OPTION_ID, "code": "dur_10_30min", "name_ru": "От 10 до 30 минут"},
    {"id": str(uuid.uuid4()), "code": "dur_unknown", "name_ru": "Не знаю, не засекали"},
]


@pytest.fixture
def ready(api):
    api.seizure_type_items = TYPES
    api.duration_items = DURATIONS
    return api


async def _to_duration(api, store, state) -> FakeMessage:
    """Довести сценарий до выбора длительности."""

    start = FakeMessage(text=texts.BTN_SEIZURE)
    await scenarios.seizure_start(start, state, api, store, SETTINGS)

    callback = FakeCallback(data=f"{keyboards.SEIZURE_TYPE_PREFIX}{TYPE_ID}")
    await scenarios.seizure_type(callback, state, api, store)
    return callback.message


class TestScale:
    @pytest.mark.asyncio
    async def test_duration_buttons_come_from_the_dictionary(self, ready, linked_store, state):
        """Шкала — из справочника анкеты, а не своя: семья отвечает на один и
        тот же вопрос в кабинете и в чате, иначе ряды за разные месяцы нельзя
        сравнить (вопрос 23)."""

        message = await _to_duration(ready, linked_store, state)

        labels = [b.text for row in message.last_markup.inline_keyboard for b in row]
        assert "От 10 до 30 минут" in labels
        assert "Меньше 1 минуты" in labels
        assert texts.BTN_SEIZURE_EXACT in labels

    @pytest.mark.asyncio
    async def test_interval_is_saved_as_a_reference_not_as_seconds(
        self, ready, linked_store, state
    ):
        """Главное в этом сценарии. «От 10 до 30 минут», записанное числом,
        становится неотличимым от засечённого секундомером — а по нему врач
        судит о течении болезни (ADR-0020)."""

        await _to_duration(ready, linked_store, state)

        callback = FakeCallback(data=f"{keyboards.SEIZURE_DURATION_PREFIX}{OPTION_ID}")
        await scenarios.seizure_duration(callback, state)
        await answer_when_now(callback.message, state, ready, linked_store)

        payload = ready.logs[0]["payload"]
        assert ready.logs[0]["kind"] == "seizures"
        assert payload["duration_option_id"] == OPTION_ID
        assert "duration_sec" not in payload
        assert payload["seizure_type_id"] == TYPE_ID

    @pytest.mark.asyncio
    async def test_exact_seconds_are_saved_as_seconds(self, ready, linked_store, state):
        """Кто засекал — вводит число, и оно остаётся числом (ТЗ 7.3: «ввести»)."""

        await _to_duration(ready, linked_store, state)

        callback = FakeCallback(data=keyboards.SEIZURE_EXACT_DATA)
        await scenarios.seizure_duration_exact_ask(callback, state)
        message = FakeMessage(text="90")
        await scenarios.seizure_duration_exact(message, state)
        await answer_when_now(message, state, ready, linked_store)

        payload = ready.logs[0]["payload"]
        assert payload["duration_sec"] == 90
        assert "duration_option_id" not in payload

    @pytest.mark.asyncio
    async def test_nonsense_duration_is_asked_again(self, ready, linked_store, state):
        await _to_duration(ready, linked_store, state)
        callback = FakeCallback(data=keyboards.SEIZURE_EXACT_DATA)
        await scenarios.seizure_duration_exact_ask(callback, state)

        message = FakeMessage(text="полторы минуты")
        await scenarios.seizure_duration_exact(message, state)

        assert "число" in message.last
        assert ready.logs == []
        assert await state.get_state() == scenarios.Seizure.duration_exact.state

    @pytest.mark.asyncio
    async def test_absurd_duration_is_rejected(self, ready, linked_store, state):
        """Сутки — предел API. Бот не решает, какая длительность правдоподобна
        (раздел 7.5 ТЗ), но и не отправляет заведомо невозможное."""

        await _to_duration(ready, linked_store, state)
        callback = FakeCallback(data=keyboards.SEIZURE_EXACT_DATA)
        await scenarios.seizure_duration_exact_ask(callback, state)

        message = FakeMessage(text="100000")
        await scenarios.seizure_duration_exact(message, state)

        assert ready.logs == []


class TestConfirmation:
    @pytest.mark.asyncio
    async def test_echo_names_the_type_and_the_duration(self, ready, linked_store, state):
        """Эхо, а не голое «Записано ✓»: две записи подряд иначе неотличимы,
        а ошибку в типе приступа не заметить."""

        await _to_duration(ready, linked_store, state)
        callback = FakeCallback(data=f"{keyboards.SEIZURE_DURATION_PREFIX}{OPTION_ID}")
        await scenarios.seizure_duration(callback, state)
        await answer_when_now(callback.message, state, ready, linked_store)

        assert "Тонико-клонический" in callback.message.last
        assert "От 10 до 30 минут" in callback.message.last


class TestWhenThingsGoWrong:
    @pytest.mark.asyncio
    async def test_empty_dictionary_sends_to_the_cabinet(self, api, linked_store, state):
        """Пустой справочник сам не наполнится: «попробуйте позже» здесь —
        совет в никуда."""

        api.seizure_type_items = []
        message = FakeMessage(text=texts.BTN_SEIZURE)

        await scenarios.seizure_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.SEIZURE_NO_TYPES
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_api_failure_does_not_leave_the_scenario_open(self, api, linked_store, state):
        api.dictionary_error = BotApiError("internal", "сбой", 500)
        message = FakeMessage(text=texts.BTN_SEIZURE)

        await scenarios.seizure_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.API_UNAVAILABLE
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_revoked_link_is_told_as_such(self, api, linked_store, state):
        api.dictionary_error = LinkRevokedError("forbidden", "отозвана", 403)
        message = FakeMessage(text=texts.BTN_SEIZURE)

        await scenarios.seizure_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.LINK_REVOKED
        assert await linked_store.get(message.chat.id) is None

    @pytest.mark.asyncio
    async def test_unlinked_chat_is_asked_for_the_code(self, api, store, state):
        message = FakeMessage(text=texts.BTN_SEIZURE)

        await scenarios.seizure_start(message, state, api, store, SETTINGS)

        assert "код" in message.last.lower()
        assert await state.get_state() is None
