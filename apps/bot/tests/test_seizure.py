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

from .test_scenarios import FakeCallback, FakeMessage

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
    await scenarios.seizure_count(callback, state, api, store, SETTINGS)
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
        await scenarios.seizure_duration(callback, state, ready, linked_store, SETTINGS)

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
        await scenarios.seizure_duration_exact(message, state, ready, linked_store, SETTINGS)

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
        await scenarios.seizure_duration_exact(message, state, ready, linked_store, SETTINGS)

        assert ready.logs[0]["payload"]["duration_sec"] == seconds

    @pytest.mark.asyncio
    async def test_nonsense_duration_is_asked_again(self, ready, linked_store, state):
        await _to_duration(ready, linked_store, state)
        callback = FakeCallback(data=keyboards.SEIZURE_EXACT_DATA)
        await scenarios.seizure_duration_exact_ask(callback, state)

        message = FakeMessage(text="полторы минуты")
        await scenarios.seizure_duration_exact(message, state, ready, linked_store, SETTINGS)

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
        await scenarios.seizure_duration_exact(message, state, ready, linked_store, SETTINGS)

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
        await scenarios.seizure_duration_exact(message, state, ready, linked_store, SETTINGS)

        assert ready.logs == []


class TestConfirmation:
    @pytest.mark.asyncio
    async def test_echo_names_the_type_and_the_duration(self, ready, linked_store, state):
        """Эхо, а не голое «Записано ✓»: две записи подряд иначе неотличимы,
        а ошибку в типе приступа не заметить."""

        await _to_duration(ready, linked_store, state)
        callback = FakeCallback(data=f"{keyboards.SEIZURE_DURATION_PREFIX}{OPTION_ID}")
        await scenarios.seizure_duration(callback, state, ready, linked_store, SETTINGS)

        assert "Тонико-клонический" in callback.message.last
        assert "От 10 до 30 минут" in callback.message.last
        # Один приступ числа в эхе не несёт: «приступов: 1» читалось как шум.
        assert "приступов" not in callback.message.last

    @pytest.mark.asyncio
    async def test_echo_of_a_series_names_the_count_and_the_longest(
        self, ready, linked_store, state
    ):
        await _to_duration(ready, linked_store, state, count=3)
        callback = FakeCallback(data=f"{keyboards.SEIZURE_DURATION_PREFIX}{OPTION_ID}")
        await scenarios.seizure_duration(callback, state, ready, linked_store, SETTINGS)

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
        await scenarios.seizure_duration(callback, state, ready, linked_store, SETTINGS)

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
        await scenarios.seizure_count_exact(typed, state, ready, linked_store, SETTINGS)
        assert typed.last == texts.SEIZURE_ASK_DURATION_SERIES

        exact = FakeCallback(data=keyboards.SEIZURE_EXACT_DATA)
        await scenarios.seizure_duration_exact_ask(exact, state)
        assert exact.message.last == texts.SEIZURE_ASK_EXACT_SERIES
        seconds = FakeMessage(text="40")
        await scenarios.seizure_duration_exact(seconds, state, ready, linked_store, SETTINGS)

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
        await scenarios.seizure_count_exact(message, state, ready, linked_store, SETTINGS)

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
        await scenarios.seizure_count_exact(message, state, ready, linked_store, SETTINGS)
        assert await state.get_state() == scenarios.Seizure.duration.state

    @pytest.mark.asyncio
    async def test_forged_count_button_is_asked_again(self, ready, linked_store, state):
        await _to_count(ready, linked_store, state)
        callback = FakeCallback(data=f"{keyboards.SEIZURE_COUNT_PREFIX}9")
        await scenarios.seizure_count(callback, state, ready, linked_store, SETTINGS)

        assert callback.message.last == texts.SEIZURE_ASK_COUNT
        assert await state.get_state() == scenarios.Seizure.count.state

    @pytest.mark.asyncio
    async def test_state_from_before_the_count_step_saves_one(self, ready, linked_store, state):
        """Сценарий, начатый до выката шага, доходит до записи с единицей —
        так бот писал всегда, и запись важнее нового поля."""

        await state.set_state(scenarios.Seizure.duration)
        await state.update_data(seizure_type_id=TYPE_ID, seizure_duration_names={})
        callback = FakeCallback(data=f"{keyboards.SEIZURE_DURATION_PREFIX}{OPTION_ID}")
        await scenarios.seizure_duration(callback, state, ready, linked_store, SETTINGS)

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


#: Справочник ILAE 2025 в форме ответа API — номера узлов как в миграции
#: `4fdbbc0c4e38`: узла «3.3» нет, «3.3.1» висит прямо под «3».
ILAE = [
    ("1", "Фокальный приступ"),
    ("1.1", "Фокальный приступ с сохранением сознания"),
    ("1.2", "Фокальный приступ с нарушением сознания"),
    ("3", "Генерализованный приступ"),
    ("3.1", "Абсанс"),
    ("3.1.1", "Типичный абсанс"),
    ("3.2", "Генерализованный тонико-клонический приступ"),
    ("3.3.1", "Генерализованный миоклонический приступ"),
    ("4", "Неклассифицированный приступ"),
]
ILAE_IDS = {ref: str(uuid.uuid4()) for ref, _ in ILAE}
ILAE_TYPES = [
    {"id": ILAE_IDS[ref], "name_ru": name, "sort": i, "code": None, "ilae_ref": ref}
    for i, (ref, name) in enumerate(ILAE)
]


def _labels(message: FakeMessage) -> list[str]:
    return [b.text for row in message.last_markup.inline_keyboard for b in row]


class TestTwoStepTypes:
    """25 типов одним столбцом уводили «Отмену» на 26-ю строку (аудит 12.11.2026)."""

    @pytest.fixture
    def ilae(self, api):
        api.seizure_type_items = ILAE_TYPES
        api.duration_items = DURATIONS
        return api

    @pytest.mark.asyncio
    async def test_first_screen_is_the_childs_recent_types(self, ilae, linked_store, state):
        ilae.recent_types = [ILAE_IDS["3.2"], ILAE_IDS["1.1"], str(uuid.uuid4())]
        message = FakeMessage(text=texts.BTN_SEIZURE)

        await scenarios.seizure_start(message, state, ilae, linked_store, SETTINGS)

        assert message.last == texts.SEIZURE_ASK_TYPE
        labels = _labels(message)
        assert labels[:2] == [
            "Генерализованный тонико-клонический приступ",
            "Фокальный приступ с сохранением сознания",
        ]
        assert texts.BTN_SEIZURE_OTHER in labels
        assert texts.BTN_SEIZURE_UNKNOWN in labels
        assert texts.BTN_CANCEL in labels
        assert len(labels) == 5, "незнакомый тип из истории не показывается"

    @pytest.mark.asyncio
    async def test_unknown_is_the_unclassified_node(self, ilae, linked_store, state):
        """«Не знаю» — узел справочника, а не значение бота."""

        ilae.recent_types = [ILAE_IDS["1.1"]]
        message = FakeMessage(text=texts.BTN_SEIZURE)
        await scenarios.seizure_start(message, state, ilae, linked_store, SETTINGS)
        unknown = next(
            b.callback_data
            for row in message.last_markup.inline_keyboard
            for b in row
            if b.text == texts.BTN_SEIZURE_UNKNOWN
        )

        assert unknown == keyboards.SEIZURE_TYPE_PREFIX + ILAE_IDS["4"]

    @pytest.mark.asyncio
    async def test_without_history_the_groups_come_first(self, ilae, linked_store, state):
        message = FakeMessage(text=texts.BTN_SEIZURE)

        await scenarios.seizure_start(message, state, ilae, linked_store, SETTINGS)

        assert message.last == texts.SEIZURE_ASK_GROUP
        labels = _labels(message)
        assert "Фокальный приступ ›" in labels and "Генерализованный приступ ›" in labels
        assert "Неклассифицированный приступ" not in labels, "он и есть «Не знаю»"
        assert "Абсанс ›" not in labels, "подтипы — на втором шаге"

    @pytest.mark.asyncio
    async def test_other_and_back(self, ilae, linked_store, state):
        ilae.recent_types = [ILAE_IDS["1.1"]]
        await scenarios.seizure_start(
            FakeMessage(text=texts.BTN_SEIZURE), state, ilae, linked_store, SETTINGS
        )
        callback = FakeCallback(data=keyboards.SEIZURE_OTHER_DATA)
        await scenarios.seizure_other(callback, state)
        assert callback.message.last == texts.SEIZURE_ASK_GROUP

        back = FakeCallback(data=keyboards.SEIZURE_FIRST_DATA, message=callback.message)
        await scenarios.seizure_other(back, state)
        assert callback.message.last == texts.SEIZURE_ASK_TYPE
        assert _labels(callback.message)[0] == "Фокальный приступ с сохранением сознания"

    @pytest.mark.asyncio
    async def test_group_offers_itself_and_its_subtypes(self, ilae, linked_store, state):
        start = FakeMessage(text=texts.BTN_SEIZURE)
        await scenarios.seizure_start(start, state, ilae, linked_store, SETTINGS)

        callback = FakeCallback(data=keyboards.SEIZURE_GROUP_PREFIX + ILAE_IDS["3"])
        await scenarios.seizure_group(callback, state)

        labels = _labels(callback.message)
        assert labels[0] == texts.SEIZURE_GROUP_ITSELF.format(name="Генерализованный приступ")
        # Ближайший существующий предок «3.3.1» — «3»: он здесь, а не потерян.
        assert "Генерализованный миоклонический приступ" in labels
        assert "Абсанс ›" in labels
        assert "Типичный абсанс" not in labels
        assert callback.message.sent == 0, "шаг в том же сообщении"

    @pytest.mark.asyncio
    async def test_choosing_a_subtype_saves_it(self, ilae, linked_store, state):
        await scenarios.seizure_start(
            FakeMessage(text=texts.BTN_SEIZURE), state, ilae, linked_store, SETTINGS
        )
        await scenarios.seizure_type(
            FakeCallback(data=keyboards.SEIZURE_TYPE_PREFIX + ILAE_IDS["3.1.1"]), state
        )
        await scenarios.seizure_count(
            FakeCallback(data=f"{keyboards.SEIZURE_COUNT_PREFIX}1"),
            state,
            ilae,
            linked_store,
            SETTINGS,
        )
        callback = FakeCallback(data=f"{keyboards.SEIZURE_DURATION_PREFIX}{OPTION_ID}")
        await scenarios.seizure_duration(callback, state, ilae, linked_store, SETTINGS)

        assert ilae.logs[0]["payload"]["seizure_type_id"] == ILAE_IDS["3.1.1"]
        assert callback.message.last.startswith("Записано ✓ Типичный абсанс, От 10 до 30 минут")

    def test_tree_follows_the_nearest_existing_parent(self):
        nodes = [[t["id"], t["name_ru"], t["ilae_ref"]] for t in ILAE_TYPES]
        top = {name for _, name, _ in scenarios.seizure_children(nodes, None)}
        assert top == {
            "Фокальный приступ",
            "Генерализованный приступ",
            "Неклассифицированный приступ",
        }


class TestExactDurationEcho:
    @pytest.mark.parametrize(
        ("seconds", "text"), [(600, "10 мин"), (90, "1 мин 30 с"), (45, "45 с"), (0, "0 с")]
    )
    def test_minutes_not_seconds(self, seconds, text):
        assert scenarios.format_seconds(seconds) == text
