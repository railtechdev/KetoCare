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


async def _to_count(api, store, state) -> FakeMessage:
    """Довести сценарий до вопроса «сколько приступов»."""

    start = FakeMessage(text=texts.BTN_SEIZURE)
    await scenarios.seizure_start(start, state, api, store, SETTINGS)

    callback = FakeCallback(data=f"{keyboards.SEIZURE_TYPE_PREFIX}{TYPE_ID}")
    await scenarios.seizure_type(callback, state)
    return callback.message


async def _to_duration(api, store, state, count: int = 1) -> FakeMessage:
    """Довести сценарий до выбора длительности."""

    await _to_count(api, store, state)
    callback = FakeCallback(data=f"{keyboards.SEIZURE_COUNT_PREFIX}{count}")
    await scenarios.seizure_count(callback, state, api, store)
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
    @pytest.mark.parametrize(("raw", "seconds"), [("0", 0), (" 90 ", 90), ("090", 90)])
    async def test_typed_seconds_are_still_accepted(self, ready, linked_store, state, raw, seconds):
        """Строже стали только к «цифрам», которых не набирают: ноль, пробелы по
        краям и ведущий ноль принимаются, как раньше."""

        await _to_duration(ready, linked_store, state)
        callback = FakeCallback(data=keyboards.SEIZURE_EXACT_DATA)
        await scenarios.seizure_duration_exact_ask(callback, state)

        message = FakeMessage(text=raw)
        await scenarios.seizure_duration_exact(message, state)
        await answer_when_now(message, state, ready, linked_store)

        assert ready.logs[0]["payload"]["duration_sec"] == seconds

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
    @pytest.mark.parametrize("raw", ["３", "１２", "²", "1e2", "+90"])
    async def test_what_isdigit_takes_is_asked_again(self, ready, linked_store, state, raw):
        """«３» записалось бы тремя секундами, а на «²» `int()` бросал исключение
        и родитель не получал ответа вовсе: `str.isdigit()` понимает не только
        цифры, которые набирают."""

        await _to_duration(ready, linked_store, state)
        callback = FakeCallback(data=keyboards.SEIZURE_EXACT_DATA)
        await scenarios.seizure_duration_exact_ask(callback, state)

        message = FakeMessage(text=raw)
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
        assert "приступов: 1" in callback.message.last

    @pytest.mark.asyncio
    async def test_echo_of_a_series_names_the_count_and_the_longest(
        self, ready, linked_store, state
    ):
        await _to_duration(ready, linked_store, state, count=3)
        callback = FakeCallback(data=f"{keyboards.SEIZURE_DURATION_PREFIX}{OPTION_ID}")
        await scenarios.seizure_duration(callback, state)
        await answer_when_now(callback.message, state, ready, linked_store)

        assert "приступов: 3" in callback.message.last
        assert "самый долгий — От 10 до 30 минут" in callback.message.last


class TestSeriesCount:
    """Серия приступов (вопрос 35): у ребёнка со спазмами десять подряд — это
    десять, а не один, и число приступов — главная величина для врача."""

    @pytest.mark.asyncio
    async def test_count_is_asked_right_after_the_type(self, ready, linked_store, state):
        message = await _to_count(ready, linked_store, state)

        assert message.last == texts.SEIZURE_ASK_COUNT
        labels = [b.text for row in message.last_markup.inline_keyboard for b in row]
        assert labels[:4] == ["1", "2", "3", "4"]
        assert texts.BTN_SEIZURE_COUNT_MORE in labels
        assert texts.BTN_CANCEL in labels
        assert await state.get_state() == scenarios.Seizure.count.state

    @pytest.mark.asyncio
    @pytest.mark.parametrize("count", [1, 2, 4])
    async def test_button_count_is_saved(self, ready, linked_store, state, count):
        await _to_duration(ready, linked_store, state, count=count)
        callback = FakeCallback(data=f"{keyboards.SEIZURE_DURATION_PREFIX}{OPTION_ID}")
        await scenarios.seizure_duration(callback, state)
        await answer_when_now(callback.message, state, ready, linked_store)

        payload = ready.logs[0]["payload"]
        assert payload["count"] == count
        assert payload["duration_option_id"] == OPTION_ID
        assert "duration_sec" not in payload

    @pytest.mark.asyncio
    async def test_single_seizure_asks_the_usual_duration(self, ready, linked_store, state):
        message = await _to_duration(ready, linked_store, state, count=1)
        assert message.last == texts.SEIZURE_ASK_DURATION

    @pytest.mark.asyncio
    async def test_series_asks_for_the_longest_one(self, ready, linked_store, state):
        """Пороги статуса — про один приступ: сумма серии их бы размыла."""

        message = await _to_duration(ready, linked_store, state, count=2)
        assert message.last == texts.SEIZURE_ASK_DURATION_SERIES
        # Подсказка про границы интервалов остаётся и у серии.
        assert "на границе" in message.last

    @pytest.mark.asyncio
    async def test_five_or_more_is_typed_and_saved(self, ready, linked_store, state):
        await _to_count(ready, linked_store, state)
        more = FakeCallback(data=keyboards.SEIZURE_COUNT_MORE_DATA)
        await scenarios.seizure_count_more(more, state)
        assert more.message.last == texts.SEIZURE_ASK_COUNT_EXACT
        assert await state.get_state() == scenarios.Seizure.count_exact.state

        typed = FakeMessage(text=" 12 ")
        await scenarios.seizure_count_exact(typed, state, ready, linked_store)
        assert typed.last == texts.SEIZURE_ASK_DURATION_SERIES

        exact = FakeCallback(data=keyboards.SEIZURE_EXACT_DATA)
        await scenarios.seizure_duration_exact_ask(exact, state)
        assert exact.message.last == texts.SEIZURE_ASK_EXACT_SERIES
        seconds = FakeMessage(text="40")
        await scenarios.seizure_duration_exact(seconds, state)
        await answer_when_now(seconds, state, ready, linked_store)

        payload = ready.logs[0]["payload"]
        assert payload["count"] == 12
        assert payload["duration_sec"] == 40
        assert "duration_option_id" not in payload
        assert "приступов: 12" in seconds.last

    @pytest.mark.asyncio
    @pytest.mark.parametrize("raw", ["4", "0", "101", "много", "７", "5.5", "-6", ""])
    async def test_bad_typed_count_is_asked_again(self, ready, linked_store, state, raw):
        await _to_count(ready, linked_store, state)
        await scenarios.seizure_count_more(
            FakeCallback(data=keyboards.SEIZURE_COUNT_MORE_DATA), state
        )

        message = FakeMessage(text=raw)
        await scenarios.seizure_count_exact(message, state, ready, linked_store)

        assert message.last == texts.SEIZURE_COUNT_INVALID.format(low=5, high=100)
        assert await state.get_state() == scenarios.Seizure.count_exact.state
        assert ready.logs == []

    @pytest.mark.parametrize("raw", ["5", "100"])
    @pytest.mark.asyncio
    async def test_typed_count_bounds_are_inclusive(self, ready, linked_store, state, raw):
        await _to_count(ready, linked_store, state)
        await scenarios.seizure_count_more(
            FakeCallback(data=keyboards.SEIZURE_COUNT_MORE_DATA), state
        )
        message = FakeMessage(text=raw)
        await scenarios.seizure_count_exact(message, state, ready, linked_store)
        assert await state.get_state() == scenarios.Seizure.duration.state

    @pytest.mark.asyncio
    async def test_forged_count_button_is_asked_again(self, ready, linked_store, state):
        await _to_count(ready, linked_store, state)
        callback = FakeCallback(data=f"{keyboards.SEIZURE_COUNT_PREFIX}9")
        await scenarios.seizure_count(callback, state, ready, linked_store)

        assert callback.message.last == texts.SEIZURE_ASK_COUNT
        assert await state.get_state() == scenarios.Seizure.count.state

    @pytest.mark.asyncio
    async def test_state_from_before_the_count_step_saves_one(self, ready, linked_store, state):
        """Сценарий, начатый до выката шага, доходит до записи с единицей —
        так бот писал всегда, и запись важнее нового поля."""

        await state.set_state(scenarios.Seizure.duration)
        await state.update_data(seizure_type_id=TYPE_ID, seizure_duration_names={})
        callback = FakeCallback(data=f"{keyboards.SEIZURE_DURATION_PREFIX}{OPTION_ID}")
        await scenarios.seizure_duration(callback, state)
        await answer_when_now(callback.message, state, ready, linked_store)

        assert ready.logs[0]["payload"]["count"] == 1


class TestWhenThingsGoWrong:
    @pytest.mark.asyncio
    async def test_empty_dictionary_tells_whom_to_tell(self, api, linked_store, state):
        """Пустой справочник сам не наполнится: «попробуйте позже» здесь —
        совет в никуда. И кабинет не выход: без типа он приступ тоже не
        сохранит, а у семьи из Telegram кабинета нет вовсе."""

        api.seizure_type_items = []
        message = FakeMessage(text=texts.BTN_SEIZURE)

        await scenarios.seizure_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.SEIZURE_NO_TYPES
        assert "кабинет" not in message.last
        assert "врачу" in message.last
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
