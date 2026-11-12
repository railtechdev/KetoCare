"""Сценарии ввода и привязка (раздел 7 ТЗ).

Обработчики вызываются напрямую с поддельными Message/CallbackQuery: проверяется
наша логика — валидация, переходы состояний, форма запроса к API, поведение при
отзыве привязки, — а не сеть Telegram.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from bot import deps, keyboards, texts
from bot.api import TRANSPORT_ERROR, BotApiError, LinkRevokedError
from bot.config import BotSettings
from bot.handlers import fallback, records, scenarios, start

from .conftest import CHAT_ID, LINK_ID, PATIENT_ID, PATIENT_NAME, SECRET, FakeStore

# Настройки нужны шагу «когда»: время вводится по местным часам семьи. Пояс
# задан явно: `BotSettings` читает его из переменной `TZ`, и на машине с другим
# поясом (или в CI) тест проверял бы не перевод времени, а настройку окружения.
SETTINGS = BotSettings(bot_token="t", bot_api_token="s", tz="Asia/Tashkent")


def frozen(moment: datetime) -> type[datetime]:
    """Класс `datetime` с остановленным `now()`.

    Подменяется в модуле обработчиков: сам разбор времени часы уже принимает
    параметром (`parse_moment(now=...)`), а вот обработчик берёт их сам — и
    другого шва, чтобы остановить их в тесте, нет.
    """

    class Frozen(datetime):
        @classmethod
        def now(cls, tz: object | None = None) -> datetime:  # type: ignore[override]
            return moment if tz is None else moment.astimezone(tz)  # type: ignore[arg-type]

    return Frozen


@dataclass
class FakeChat:
    id: int = CHAT_ID
    type: str = "private"


@dataclass
class FakeUser:
    """`from_user` — кто прислал сообщение.

    Отдельно от чата намеренно: в личной переписке идентификаторы совпадают, но
    учётную запись родителя система заводит по человеку, а не по комнате
    (ADR-0040).
    """

    id: int = CHAT_ID
    first_name: str = "Айгуль"
    last_name: str | None = None


@dataclass
class FakeBot:
    """`message.bot`: правка карточки по номеру — шаг, начатый набранным текстом."""

    owner: Any

    async def edit_message_text(
        self, text: str, chat_id: int, message_id: int, reply_markup: Any = None, **_: Any
    ) -> None:
        self.owner.answers.append((text, reply_markup))
        self.owner.edits += 1


@dataclass
class FakeMessage:
    """Минимальный Message: только то, чем пользуются обработчики.

    `answers` — всё, что человек видит в ответ: новые сообщения и правки
    карточки по порядку (ADR-0076, одна запись — одно сообщение). `sent` и
    `edits` различают одно от другого: число сообщений в чате — это `sent`.
    """

    text: str | None = None
    chat: FakeChat = field(default_factory=FakeChat)
    from_user: FakeUser | None = field(default_factory=FakeUser)
    answers: list[tuple[str, Any]] = field(default_factory=list)
    message_id: int = 100
    sent: int = 0
    edits: int = 0
    keyboard_removed: bool = False
    #: Кнопки после правки одних кнопок (галочка в списке).
    markups: list[Any] = field(default_factory=list)
    bot: Any = None

    def __post_init__(self) -> None:
        if self.bot is None:
            self.bot = FakeBot(self)

    async def answer(self, text: str, reply_markup: Any = None, **_: Any) -> SimpleNamespace:
        self.answers.append((text, reply_markup))
        self.sent += 1
        return SimpleNamespace(message_id=1000 + self.sent)

    async def edit_text(self, text: str, reply_markup: Any = None, **_: Any) -> None:
        self.answers.append((text, reply_markup))
        self.edits += 1

    async def edit_reply_markup(self, reply_markup: Any = None, **_: Any) -> None:
        self.keyboard_removed = reply_markup is None
        self.markups.append(reply_markup)

    @property
    def last(self) -> str:
        assert self.answers, "обработчик ничего не ответил"
        return self.answers[-1][0]

    @property
    def last_markup(self) -> Any:
        assert self.answers, "обработчик ничего не ответил"
        return self.answers[-1][1]


@dataclass
class FakeCallback:
    data: str
    message: FakeMessage = field(default_factory=FakeMessage)
    answered: bool = False
    alert: str | None = None

    async def answer(self, text: str | None = None, *_: Any, **__: Any) -> None:
        self.answered = True
        self.alert = text


def labels(markup: Any) -> list[str]:
    rows = getattr(markup, "inline_keyboard", None) or getattr(markup, "keyboard", None) or []
    return [button.text for row in rows for button in row]


def datas(markup: Any) -> list[str]:
    rows = getattr(markup, "inline_keyboard", None) or []
    return [button.callback_data for row in rows for button in row if button.callback_data]


class TestLinking:
    @pytest.mark.asyncio
    async def test_start_with_code_stores_binding(self, api, store):
        message = FakeMessage(text="/start ABCD2345")

        await start._link(message, api=api, store=store, settings=SETTINGS, code="ABCD2345")

        assert PATIENT_NAME in message.last
        binding = await store.get(CHAT_ID)
        assert binding is not None
        assert binding.secret == SECRET, "секрет обязан сохраниться: восстановить его нельзя"
        # Личность берётся у автора сообщения, а не у чата: по ней сервер
        # находит или заводит учётную запись родителя (ADR-0040).
        assert api.verified_telegram_user_id == CHAT_ID

    @pytest.mark.asyncio
    async def test_welcome_tells_where_the_app_is(self, api, store):
        """«Готово, выберите, что записать» оставляло семью в боте навсегда.

        Родитель от врача не знает о приложении, и узнать ему неоткуда: это
        единственное сообщение, которое он точно прочтёт.
        """

        message = FakeMessage(text="/start ABCD2345")
        with_app = BotSettings(
            bot_token="t", bot_api_token="s", tz="Asia/Tashkent", miniapp_url="https://tma.example"
        )

        await start._link(message, api=api, store=store, settings=with_app, code="ABCD2345")

        assert "кнопка «Приложение»" in message.last

    @pytest.mark.asyncio
    @pytest.mark.parametrize("has_web_credentials", [False, True])
    async def test_welcome_leaves_the_cabinet_to_help(self, api, store, has_web_credentials):
        """Приветствие — только главное: где записывать и что остальное в
        приложении. Кабинет описан в /help (аудит продукта 12.11.2026)."""

        api.verified = replace(api.verified, has_web_credentials=has_web_credentials)
        message = FakeMessage(text="/start ABCD2345")

        await start._link(message, api=api, store=store, settings=SETTINGS, code="ABCD2345")

        assert "кабинет" not in message.last.lower()
        assert "https://app.example" not in message.last

    @pytest.mark.asyncio
    async def test_group_chat_cannot_be_linked(self, api, store):
        """Привязка — к семье, а не к комнате.

        В группе `chat.id` принадлежит группе: дневник ребёнка вёлся бы от её
        имени, уведомление о смене назначения приходило бы всем участникам, а
        Mini App искал бы привязку по идентификатору человека и не находил её.
        """

        message = FakeMessage(chat=FakeChat(id=-1001234567890, type="supergroup"))

        await start._link(message, api=api, store=store, settings=SETTINGS, code="ABCD2345")

        assert message.last == texts.LINK_ONLY_PRIVATE
        assert api.verified_code is None, "код не должен уходить в API вовсе"
        assert await store.get(-1001234567890) is None

    @pytest.mark.asyncio
    async def test_invalid_code_explains_where_to_get_a_new_one(self, api, store):
        api.verify_error = BotApiError("not_found", "нет", 404)
        message = FakeMessage()

        await start._link(message, api=api, store=store, settings=SETTINGS, code="ZZZZZZZZ")

        assert "попросите новый" in message.last
        # Не только «у врача»: код мог прислать родитель ребёнка (ADR-0042).
        assert "родителя" in message.last
        assert await store.get(CHAT_ID) is None

    @pytest.mark.asyncio
    async def test_code_for_the_same_child_is_not_an_error(self, api, store):
        """Повторный код в рабочем чате — не стена, а «всё уже готово»."""
        api.verify_error = BotApiError("conflict", "уже", 409, {"reason": "already_here"})
        message = FakeMessage()

        await start._link(message, api=api, store=store, settings=SETTINGS, code="ABCD2345")

        assert message.last == texts.LINK_ALREADY_HERE

    @pytest.mark.asyncio
    async def test_other_conflicts_say_what_the_server_said(self, api, store):
        """«У выдавшего больше нет доступа» — не «чат занят» (находка аудита 02.10.2026)."""
        api.verify_error = BotApiError(
            "conflict", "Код больше не действует: у того, кто его выдал, …", 409, {}
        )
        message = FakeMessage()

        await start._link(message, api=api, store=store, settings=SETTINGS, code="ABCD2345")

        assert message.last.startswith("Код больше не действует")

    @pytest.mark.asyncio
    async def test_bare_code_is_treated_as_a_code_not_as_chatter(self, api, store, state):
        """Родитель с компьютера переписывает код руками, а не жмёт ссылку."""

        message = FakeMessage(text="ABCD2345")

        await fallback.unknown(message, state=state, api=api, store=store, settings=SETTINGS)

        assert PATIENT_NAME in message.last
        assert await store.get(CHAT_ID) is not None

    @pytest.mark.asyncio
    async def test_chatter_gets_the_standard_answer(self, api, linked_store, state):
        """Раздел 7.5: бот не поддерживает беседу и не отвечает на вопросы."""

        message = FakeMessage(text="а какое соотношение у моего ребёнка?")

        await fallback.unknown(message, state=state, api=api, store=linked_store, settings=SETTINGS)

        # SETTINGS без MINIAPP_URL: обещать «откройте приложение» нельзя —
        # кнопки приложения в меню нет.
        assert message.last == texts.UNKNOWN_INPUT_NO_APP

    @pytest.mark.asyncio
    async def test_chatter_with_app_is_pointed_to_the_app(self, api, linked_store, state):
        with_app = BotSettings(
            bot_token="t", bot_api_token="s", miniapp_url="https://tma.example.uz"
        )
        message = FakeMessage(text="что поесть?")

        await fallback.unknown(message, state=state, api=api, store=linked_store, settings=with_app)

        assert message.last == texts.UNKNOWN_INPUT

    @pytest.mark.asyncio
    async def test_unlinked_chatter_is_told_how_to_link(self, api, store, state):
        """Непривязанному — про привязку: его следующий шаг — код, а не кнопки."""

        message = FakeMessage(text="здравствуйте")

        await fallback.unknown(message, state=state, api=api, store=store, settings=SETTINGS)

        assert message.last == texts.NOT_LINKED

    def test_code_shape(self):
        assert start.looks_like_code("ABCD2345")
        assert start.looks_like_code("  ABCD2345 ")
        assert not start.looks_like_code("ABCD234")
        # Код диктуют и записывают группами — это всё ещё код.
        assert start.looks_like_code("ABCD 2345")
        assert start.looks_like_code("ABCD-2345")
        assert start.compact_code(" abcd-2345 ") == "abcd2345"
        assert not start.looks_like_code("здравствуйте")

    @pytest.mark.asyncio
    async def test_bare_code_in_a_linked_chat_gets_an_answer(self, api, linked_store, state):
        """Раньше код в привязанном чате молча уходил в «я умею записывать данные»."""
        api.verify_error = BotApiError("conflict", "уже", 409, {"reason": "already_here"})
        message = FakeMessage(text="ABCD 2345")

        await fallback.unknown(message, state=state, api=api, store=linked_store, settings=SETTINGS)

        assert message.last == texts.LINK_ALREADY_HERE


class TestKetones:
    @pytest.mark.asyncio
    async def test_requires_binding(self, store, state):
        message = FakeMessage()

        await scenarios.ketones_start(message, state, store)

        assert message.last == texts.NOT_LINKED
        assert await state.get_state() is None, "без привязки сценарий не начинается"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("raw", ["12.1", "-1", "100"])
    async def test_out_of_range_is_re_asked(self, api, linked_store, state, raw):
        message = FakeMessage(text=raw)
        await state.set_state(scenarios.Ketones.value)

        await scenarios.ketones_value(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.KETONES_OUT_OF_RANGE
        assert await state.get_state() == scenarios.Ketones.value.state

    @pytest.mark.asyncio
    @pytest.mark.parametrize("raw", ["много", "1_0", "1e1", "NaN", "３"])
    async def test_not_a_number_is_re_asked(self, api, linked_store, state, raw):
        """«1_0» и «1e1» — это 10 для `Decimal` и опечатка для человека."""

        message = FakeMessage(text=raw)
        await state.set_state(scenarios.Ketones.value)

        await scenarios.ketones_value(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.KETONES_NOT_A_NUMBER
        assert await state.get_state() == scenarios.Ketones.value.state

    @pytest.mark.asyncio
    async def test_comma_is_accepted_as_a_separator(self, api, linked_store, state):
        message = FakeMessage(text="3,2")
        await state.set_state(scenarios.Ketones.value)

        await scenarios.ketones_value(message, state, api, linked_store, SETTINGS)

        assert (await state.get_data())["value"] == "3.2"

    @pytest.mark.asyncio
    async def test_first_record_asks_the_method_and_saves_at_once(self, api, linked_store, state):
        """Шага «Когда это было?» больше нет: запись уходит сразу, «сейчас»."""

        start = FakeMessage(text=texts.BTN_KETONES)
        await scenarios.ketones_start(start, state, linked_store)
        message = FakeMessage(text="3.2")
        await scenarios.ketones_value(message, state, api, linked_store, SETTINGS)
        assert message.last == texts.KETONES_ASK_METHOD

        callback = FakeCallback(data=f"{keyboards.KETONE_METHOD_PREFIX}blood")
        await scenarios.ketones_method(callback, state, api, linked_store, SETTINGS)

        assert len(api.logs) == 1
        sent = api.logs[0]
        assert sent["kind"] == "ketones"
        assert sent["payload"]["value"] == "3.2"
        assert sent["payload"]["method"] == "blood"
        assert sent["patient_id"] == PATIENT_ID
        assert sent["link_id"] == LINK_ID
        assert "occurred_at" in sent["payload"], "время ставит бот, а не сервер"
        assert "source" not in sent["payload"], "канал проставляет сервер по токену"
        confirmation = callback.message.last
        assert confirmation.startswith("Записано ✓")
        assert "3,2" in confirmation and "ммоль/л" in confirmation and "кровь" in confirmation
        assert texts.WHEN_JUST_NOW in confirmation
        assert await state.get_state() is None
        # Под ответом — исправить на месте.
        assert texts.BTN_OTHER_TIME in labels(callback.message.last_markup)
        assert texts.BTN_DELETE_RECORD in labels(callback.message.last_markup)
        assert texts.BTN_KETONES_WAS_URINE in labels(callback.message.last_markup)

    @pytest.mark.asyncio
    async def test_method_is_remembered_per_child(self, api, linked_store, state):
        """Второй замер — без вопроса о методе: одно сообщение, одно число."""

        await linked_store.set_ketone_method(CHAT_ID, PATIENT_ID, "urine")
        start = FakeMessage(text=texts.BTN_KETONES)
        await scenarios.ketones_start(start, state, linked_store)
        message = FakeMessage(text="1,2")

        await scenarios.ketones_value(message, state, api, linked_store, SETTINGS)

        assert api.logs[0]["payload"]["method"] == "urine"
        assert "моча" in message.last
        assert texts.BTN_KETONES_WAS_BLOOD in labels(message.last_markup)
        # Карточка правится, а не шлётся новым сообщением.
        assert start.sent == 1 and message.sent == 0 and message.edits == 1


class TestWeight:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("raw", ["1.9", "151", "0"])
    async def test_out_of_range_is_re_asked(self, api, linked_store, state, raw):
        message = FakeMessage(text=raw)
        await state.set_state(scenarios.Weight.value)

        await scenarios.weight_value(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.WEIGHT_OUT_OF_RANGE
        assert not api.logs

    @pytest.mark.asyncio
    async def test_valid_value_is_sent_and_echoed_in_the_same_card(self, api, linked_store, state):
        start = FakeMessage(text=texts.BTN_WEIGHT)
        await scenarios.weight_start(start, state, linked_store)
        message = FakeMessage(text="18.4")

        await scenarios.weight_value(message, state, api, linked_store, SETTINGS)

        assert api.logs[0]["kind"] == "weight"
        assert api.logs[0]["payload"]["weight_kg"] == "18.4"
        assert message.last.startswith("Записано ✓")
        assert "18,4" in message.last and "кг" in message.last
        assert message.sent == 0, "эхо заменяет вопрос, а не приходит новым сообщением"


class TestWellbeing:
    @pytest.mark.asyncio
    async def test_one_message_is_the_record(self, api, linked_store, state):
        await state.set_state(scenarios.Wellbeing.symptom)
        message = FakeMessage(text="вялость")

        await scenarios.wellbeing_symptom(message, state, api, linked_store, SETTINGS)

        payload = api.logs[0]["payload"]
        assert api.logs[0]["kind"] == "side-effects"
        assert payload["symptom"] == "вялость"
        assert "description" not in payload

    @pytest.mark.asyncio
    async def test_longer_text_keeps_every_word(self, api, linked_store, state):
        """Первая строка — «что беспокоит», весь текст — описание: ничего не теряется."""

        await state.set_state(scenarios.Wellbeing.symptom)
        text = "вялость\nпосле обеда, спал два часа"
        message = FakeMessage(text=text)

        await scenarios.wellbeing_symptom(message, state, api, linked_store, SETTINGS)

        payload = api.logs[0]["payload"]
        assert payload["symptom"] == "вялость"
        assert payload["description"] == text

    def test_long_first_line_is_cut_for_the_list_only(self):
        text = "я" * 300
        symptom, description = scenarios.split_wellbeing(text)
        assert len(symptom) == scenarios.SYMPTOM_MAX_LENGTH
        assert description == text

    @pytest.mark.asyncio
    async def test_too_long_text_is_re_asked(self, api, linked_store, state):
        message = FakeMessage(text="я" * (scenarios.DESCRIPTION_MAX_LENGTH + 1))
        await state.set_state(scenarios.Wellbeing.symptom)

        await scenarios.wellbeing_symptom(message, state, api, linked_store, SETTINGS)

        assert "2000" in message.last
        assert await state.get_state() == scenarios.Wellbeing.symptom.state
        assert not api.logs


class TestCancelAndFailures:
    @pytest.mark.asyncio
    async def test_cancel_clears_state_in_the_same_card(self, state):
        await state.set_state(scenarios.Ketones.value)
        callback = FakeCallback(data=keyboards.CANCEL_DATA)

        await scenarios.cancel(callback, state)

        assert await state.get_state() is None
        assert callback.message.last == texts.CANCELLED
        assert callback.message.last_markup is None, "у отменённого кнопок не остаётся"
        assert callback.message.sent == 0
        assert callback.answered, "инлайновую кнопку надо погасить, иначе она крутится"

    @pytest.mark.asyncio
    async def test_cancel_after_the_record_is_saved_does_not_claim_a_cancel(self, state):
        """«Отмена» под сохранённой записью отвечала «Отменено», а запись
        оставалась в дневнике (аудит 12.11.2026)."""

        callback = FakeCallback(data=keyboards.CANCEL_DATA)

        await scenarios.cancel(callback, state)

        assert callback.alert == texts.BUTTON_STALE
        assert callback.message.answers == [], "«Отменено» в чат не уходит"
        assert callback.message.keyboard_removed

    @pytest.mark.asyncio
    async def test_a_button_of_a_finished_step_is_answered(self):
        callback = FakeCallback(data="sdur:old")

        await fallback.stale_button(callback)

        assert callback.alert == texts.BUTTON_STALE
        assert callback.message.keyboard_removed

    @pytest.mark.asyncio
    async def test_revoked_binding_is_forgotten_and_the_menu_removed(
        self, api, linked_store, state
    ):
        """Отозванная привязка не должна оставаться у бота, и её меню — тоже:
        каждая кнопка отвечала бы «чат не привязан»."""

        from aiogram.types import ReplyKeyboardRemove

        api.log_error = LinkRevokedError("unauthorized", "отозвана", 401)
        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)

        await scenarios.weight_value(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.LINK_REVOKED
        assert isinstance(message.last_markup, ReplyKeyboardRemove)
        assert await linked_store.get(CHAT_ID) is None
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_api_failure_keeps_binding_and_offers_a_retry(self, api, linked_store, state):
        api.log_error = BotApiError("internal", "сбой", 500)
        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)

        await scenarios.weight_value(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.API_UNAVAILABLE
        assert keyboards.RETRY_DATA in datas(message.last_markup)
        assert await linked_store.get(CHAT_ID) is not None

    @pytest.mark.asyncio
    async def test_no_connection_says_so_and_retry_reuses_the_key(self, api, linked_store, state):
        """Обрыв связи — не молчание и не вторая запись (ADR-0035).

        «Повторить» отправляет ту же попытку: тот же ключ и то же тело, байт в
        байт. Если первая запись всё-таки дошла, сервер вернёт её.
        """

        api.log_error = BotApiError(TRANSPORT_ERROR, "ConnectError", 0)
        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)

        await scenarios.weight_value(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.NO_CONNECTION
        assert await state.get_state() is not None, "введённое не теряется"

        api.log_error = None
        callback = FakeCallback(data=keyboards.RETRY_DATA, message=message)
        await scenarios.retry(callback, state, api, linked_store, SETTINGS)

        assert len(api.idempotency_keys) == 2
        assert api.idempotency_keys[0] == api.idempotency_keys[1]
        assert api.attempt_bodies[0] == api.attempt_bodies[1]
        assert len(api.logs) == 1
        assert message.last.startswith("Записано ✓")

    @pytest.mark.asyncio
    async def test_server_refusal_retry_keeps_the_key(self, api, linked_store, state):
        """Отказ — 502 прокси или «запрос ещё выполняется» — не значит, что
        записи нет. Повтор с новым ключом её задвоил бы; бронь ключа при
        настоящем отказе сервер откатывает, и тот же ключ безопасен."""

        api.log_error = BotApiError(None, "Bad Gateway", 502)
        message = FakeMessage(text="18.4")
        await state.set_state(scenarios.Weight.value)
        await scenarios.weight_value(message, state, api, linked_store, SETTINGS)
        assert message.last == texts.API_UNAVAILABLE

        api.log_error = None
        callback = FakeCallback(data=keyboards.RETRY_DATA, message=message)
        await scenarios.retry(callback, state, api, linked_store, SETTINGS)

        assert api.idempotency_keys[0] == api.idempotency_keys[1]
        assert len(api.logs) == 1

    @pytest.mark.asyncio
    async def test_new_value_after_a_refusal_is_a_new_record(self, api, linked_store, state):
        """Набранное заново после отказа — новая запись, а не прежнее тело."""

        api.log_error = BotApiError("validation_error", "нет", 422)
        await state.set_state(scenarios.Weight.value)
        await scenarios.weight_value(FakeMessage(text="18.4"), state, api, linked_store, SETTINGS)

        api.log_error = None
        await scenarios.weight_value(FakeMessage(text="18.5"), state, api, linked_store, SETTINGS)

        assert api.logs[0]["payload"]["weight_kg"] == "18.5"
        assert api.idempotency_keys[0] != api.idempotency_keys[1]

    @pytest.mark.asyncio
    async def test_retry_without_a_pending_record_is_stale(self, api, linked_store, state):
        callback = FakeCallback(data=keyboards.RETRY_DATA)
        await scenarios.retry(callback, state, api, linked_store, SETTINGS)
        assert callback.alert == texts.BUTTON_STALE
        assert not api.logs

    @pytest.mark.asyncio
    async def test_each_new_entry_gets_its_own_key(self, api, linked_store, state):
        for value in ("18.4", "18.5"):
            message = FakeMessage(text=value)
            await state.set_state(scenarios.Weight.value)
            await scenarios.weight_value(message, state, api, linked_store, SETTINGS)

        assert len(set(api.idempotency_keys)) == 2


class TestWiring:
    def test_fallback_router_is_last(self, dispatcher):
        """Порядок роутеров — часть поведения: fallback ловит всё подряд."""

        names = [router.name for router in dispatcher.sub_routers]
        assert names == ["start", "scenarios", "records", "fallback"]

    def test_main_menu_has_every_scenario_of_the_spec(self):
        """Раздел 7.2 — семь кнопок; язык уехал в справку, на его месте помощь."""

        assert set(labels(keyboards.main_menu(SETTINGS))) == {
            texts.BTN_SEIZURE,
            texts.BTN_KETONES,
            texts.BTN_WEIGHT,
            texts.BTN_MEAL,
            texts.BTN_MEDICATION,
            texts.BTN_WELLBEING,
            texts.BTN_HELP,
        }

    def test_seizure_is_red_and_the_menu_stays(self):
        menu = keyboards.main_menu(SETTINGS)
        assert menu.keyboard[0][0].text == texts.BTN_SEIZURE
        assert menu.keyboard[0][0].style == "danger"
        assert menu.is_persistent is True


class TestMiniAppEntry:
    """Mini App открывается кнопкой МЕНЮ, а не кнопкой клавиатуры.

    Документация Telegram: «initData … empty if the Mini App was launched from
    a keyboard button». Приложение, открытое из клавиатуры, подписи не получает
    вовсе и войти не может — проверено на живом стенде: клиент передавал
    `tgWebAppVersion`, `tgWebAppPlatform`, `tgWebAppThemeParams` и ни одного
    `tgWebAppData`.
    """

    def test_keyboard_has_no_app_button_even_when_deployed(self):
        with_app = BotSettings(
            bot_token="t", bot_api_token="s", miniapp_url="https://tma.example.uz"
        )

        labels = {b.text for row in keyboards.main_menu(with_app).keyboard for b in row}

        assert all("риложение" not in label for label in labels)

    @pytest.mark.asyncio
    async def test_menu_button_carries_the_address(self):
        from aiogram.types import MenuButtonWebApp

        from bot.main import setup_bot_profile

        with_app = BotSettings(
            bot_token="t", bot_api_token="s", miniapp_url="https://tma.example.uz"
        )
        seen: dict[str, object] = {}

        class FakeBot:
            async def set_my_commands(self, *_: object, **__: object) -> None: ...

            async def set_my_description(self, *_: object, **__: object) -> None: ...

            async def set_my_short_description(self, *_: object, **__: object) -> None: ...

            async def set_chat_menu_button(self, *, menu_button: object) -> None:
                seen["button"] = menu_button

        await setup_bot_profile(FakeBot(), with_app)  # type: ignore[arg-type]

        button = seen["button"]
        assert isinstance(button, MenuButtonWebApp)
        assert button.web_app.url == "https://tma.example.uz"

    @pytest.mark.asyncio
    async def test_menu_button_is_reset_without_an_address(self):
        """Кнопка меню, ведущая в никуда, хуже отсутствующей: она занимает
        единственное видное место рядом с полем ввода."""

        from aiogram.types import MenuButtonDefault

        from bot.main import setup_bot_profile

        seen: dict[str, object] = {}

        class FakeBot:
            async def set_my_commands(self, *_: object, **__: object) -> None: ...

            async def set_my_description(self, *_: object, **__: object) -> None: ...

            async def set_my_short_description(self, *_: object, **__: object) -> None: ...

            async def set_chat_menu_button(self, *, menu_button: object) -> None:
                seen["button"] = menu_button

        await setup_bot_profile(FakeBot(), SETTINGS)  # type: ignore[arg-type]

        assert isinstance(seen["button"], MenuButtonDefault)


class TestRecordActions:
    """Кнопки под «Записано ✓»: другое время, удаление, метод (ADR-0076).

    Время события задаёт семья, а не момент отправки: по времени замеров
    врач судит о динамике. Только теперь оно не стоит отдельным шагом перед
    каждой записью, а правится под ответом.
    """

    async def _saved_weight(self, api, store, state) -> tuple[FakeMessage, str]:
        start = FakeMessage(text=texts.BTN_WEIGHT)
        await scenarios.weight_start(start, state, store)
        message = FakeMessage(text="18.4")
        await scenarios.weight_value(message, state, api, store, SETTINGS)
        key = next(
            data.removeprefix(keyboards.RECORD_TIME_PREFIX)
            for data in datas(message.last_markup)
            if data.startswith(keyboards.RECORD_TIME_PREFIX)
        )
        return message, key

    @pytest.mark.asyncio
    async def test_quick_time_moves_the_record(self, api, linked_store, state, monkeypatch):
        moment = frozen(datetime(2026, 8, 31, 12, 0, tzinfo=UTC))
        monkeypatch.setattr(records, "datetime", moment)
        monkeypatch.setattr(deps, "datetime", moment)
        echo, key = await self._saved_weight(api, linked_store, state)
        log_id = api.logs[0]["id"]

        card_message = FakeMessage(message_id=1001)
        await records.other_time(
            FakeCallback(data=keyboards.RECORD_TIME_PREFIX + key, message=card_message),
            state,
            linked_store,
            SETTINGS,
        )
        assert "Когда это было?" in card_message.last
        assert texts.BTN_TIME_MORNING in labels(card_message.last_markup)

        await records.quick_time(
            FakeCallback(
                data=f"{keyboards.RECORD_QUICK_PREFIX}{keyboards.QUICK_MORNING}:{key}",
                message=card_message,
            ),
            state,
            api,
            linked_store,
            SETTINGS,
        )

        assert api.updates == [("weight", log_id, {"occurred_at": "2026-08-31T08:00:00+05:00"})]
        assert card_message.last.startswith("Записано ✓")
        assert texts.WHEN_TODAY_AT.format(time="08:00") in card_message.last
        assert await state.get_state() is None
        assert len(api.logs) == 1, "время правится, вторая запись не заводится"

    @pytest.mark.asyncio
    async def test_typed_time_is_accepted_on_the_time_step(
        self, api, linked_store, state, monkeypatch
    ):
        moment = frozen(datetime(2026, 8, 31, 12, 0, tzinfo=UTC))
        monkeypatch.setattr(records, "datetime", moment)
        monkeypatch.setattr(deps, "datetime", moment)
        _, key = await self._saved_weight(api, linked_store, state)
        await records.other_time(
            FakeCallback(data=keyboards.RECORD_TIME_PREFIX + key), state, linked_store, SETTINGS
        )

        typed = FakeMessage(text="07:30")
        await records.typed_time(typed, state, api, linked_store, SETTINGS)

        # 07:30 по Ташкенту — 02:30 UTC.
        occurred = api.updates[0][2]["occurred_at"]
        assert datetime.fromisoformat(occurred).astimezone(UTC).strftime("%H:%M") == "02:30"
        assert texts.WHEN_TODAY_AT.format(time="07:30") in typed.last

    @pytest.mark.asyncio
    async def test_bad_typed_time_is_re_asked(self, api, linked_store, state):
        _, key = await self._saved_weight(api, linked_store, state)
        await records.other_time(
            FakeCallback(data=keyboards.RECORD_TIME_PREFIX + key), state, linked_store, SETTINGS
        )

        typed = FakeMessage(text="вчера утром")
        await records.typed_time(typed, state, api, linked_store, SETTINGS)

        assert typed.last == texts.WHEN_BAD_FORMAT
        assert not api.updates
        assert await state.get_state() == records.RecordTime.waiting.state

    @pytest.mark.asyncio
    async def test_future_time_gets_its_own_explanation(self, api, linked_store, state):
        _, key = await self._saved_weight(api, linked_store, state)
        await records.other_time(
            FakeCallback(data=keyboards.RECORD_TIME_PREFIX + key), state, linked_store, SETTINGS
        )
        tomorrow = datetime.now(ZoneInfo(SETTINGS.tz)) + timedelta(days=1)

        typed = FakeMessage(text=tomorrow.strftime("%d.%m %H:%M"))
        await records.typed_time(typed, state, api, linked_store, SETTINGS)

        assert typed.last == texts.WHEN_IN_FUTURE
        assert not api.updates

    @pytest.mark.asyncio
    async def test_delete_asks_once_more_and_deletes(self, api, linked_store, state):
        _, key = await self._saved_weight(api, linked_store, state)
        log_id = api.logs[0]["id"]
        card_message = FakeMessage()

        await records.delete_ask(
            FakeCallback(data=keyboards.RECORD_DELETE_PREFIX + key, message=card_message),
            state,
            linked_store,
        )
        assert not api.deleted, "удаление — со вторым нажатием"
        assert "18,4" in card_message.last

        await records.delete_confirmed(
            FakeCallback(data=keyboards.RECORD_DELETE_YES_PREFIX + key, message=card_message),
            state,
            api,
            linked_store,
            SETTINGS,
        )

        assert api.deleted == [("weight", log_id)]
        assert card_message.last.startswith("Запись удалена")
        assert card_message.last_markup is None
        assert await linked_store.receipt(CHAT_ID, key) is None

    @pytest.mark.asyncio
    async def test_ketone_method_is_switched_and_remembered(self, api, linked_store, state):
        await linked_store.set_ketone_method(CHAT_ID, PATIENT_ID, "blood")
        await scenarios.ketones_start(FakeMessage(text=texts.BTN_KETONES), state, linked_store)
        message = FakeMessage(text="1.2")
        await scenarios.ketones_value(message, state, api, linked_store, SETTINGS)
        key = datas(message.last_markup)[0].removeprefix(keyboards.RECORD_METHOD_PREFIX)

        card_message = FakeMessage()
        await records.switch_ketone_method(
            FakeCallback(data=keyboards.RECORD_METHOD_PREFIX + key, message=card_message),
            state,
            api,
            linked_store,
            SETTINGS,
        )

        assert api.updates[0][2] == {"method": "urine"}
        assert "моча" in card_message.last
        assert await linked_store.ketone_method(CHAT_ID, PATIENT_ID) == "urine"
        assert texts.BTN_KETONES_WAS_BLOOD in labels(card_message.last_markup)

    @pytest.mark.asyncio
    async def test_expired_receipt_is_answered(self, api, linked_store, state):
        callback = FakeCallback(data=keyboards.RECORD_DELETE_YES_PREFIX + "0" * 32)
        await records.delete_confirmed(callback, state, api, linked_store, SETTINGS)
        assert callback.alert == texts.RECORD_EXPIRED
        assert not api.deleted

    @pytest.mark.asyncio
    async def test_record_deleted_elsewhere_says_so(self, api, linked_store, state):
        _, key = await self._saved_weight(api, linked_store, state)
        api.update_error = BotApiError("not_found", "нет", 404)
        card_message = FakeMessage()

        await records.quick_time(
            FakeCallback(
                data=f"{keyboards.RECORD_QUICK_PREFIX}{keyboards.QUICK_HOUR}:{key}",
                message=card_message,
            ),
            state,
            api,
            linked_store,
            SETTINGS,
        )

        assert card_message.last == texts.RECORD_GONE


class TestMeal:
    """Меню на сегодня списком с галочками — одним сообщением (ADR-0076)."""

    @staticmethod
    def menu() -> dict[str, Any]:
        return {
            "items": [
                {"id": "item-1", "meal_index": 1, "title": "Омлет с маслом", "eaten": False},
                {"id": "item-4", "meal_index": 1, "title": "Огурец", "eaten": False},
                {"id": "item-3", "meal_index": 2, "title": "Суп со сливками", "eaten": False},
                {"id": "item-2", "meal_index": 3, "title": "Курица с брокколи", "eaten": True},
            ]
        }

    async def _started(self, api, store, state) -> FakeMessage:
        api.menu = self.menu()
        message = FakeMessage(text=texts.BTN_MEAL)
        await scenarios.meal_start(message, state, api, store, SETTINGS)
        return message

    @pytest.mark.asyncio
    async def test_eaten_is_shown_but_not_pressable(self, api, linked_store, state):
        message = await self._started(api, linked_store, state)

        assert message.last == texts.MEAL_ASK
        buttons = message.last_markup.inline_keyboard
        flat = [b for row in buttons for b in row]
        eaten = next(b for b in flat if "Курица" in b.text)
        assert eaten.disabled is not None and eaten.callback_data is None
        assert any(b.text.endswith("Приём 1: Омлет с маслом") for b in flat)
        assert texts.BTN_MEAL_WHOLE.format(meal="Приём 1") in [b.text for b in flat]

    @pytest.mark.asyncio
    async def test_tap_marks_at_once_and_ticks_the_same_message(self, api, linked_store, state):
        message = await self._started(api, linked_store, state)

        callback = FakeCallback(data=f"{keyboards.MEAL_ITEM_PREFIX}item-1", message=message)
        await scenarios.meal_toggle(callback, state, api, linked_store, SETTINGS)

        assert api.eaten == ["item-1"]
        assert callback.alert == texts.MEAL_TOAST_MARKED
        assert message.sent == 1, "отметка не шлёт новых сообщений"
        ticked = labels(message.markups[-1])
        assert keyboards.MARKED + "Приём 1: Омлет с маслом" in ticked
        assert texts.BTN_DONE in ticked and texts.BTN_CANCEL not in ticked

    @pytest.mark.asyncio
    async def test_second_tap_unmarks(self, api, linked_store, state):
        """Ошибочное нажатие не должно остаться в данных навсегда."""

        message = await self._started(api, linked_store, state)
        for _ in range(2):
            callback = FakeCallback(data=f"{keyboards.MEAL_ITEM_PREFIX}item-1", message=message)
            await scenarios.meal_toggle(callback, state, api, linked_store, SETTINGS)

        assert api.unmarked == ["item-1"]
        assert callback.alert == texts.MEAL_TOAST_UNMARKED
        assert (await state.get_data())["meal_marked"] == []

    @pytest.mark.asyncio
    async def test_whole_meal_marks_every_open_dish(self, api, linked_store, state):
        message = await self._started(api, linked_store, state)

        callback = FakeCallback(data=f"{keyboards.MEAL_WHOLE_PREFIX}1", message=message)
        await scenarios.meal_whole(callback, state, api, linked_store, SETTINGS)

        assert sorted(api.eaten) == ["item-1", "item-4"]

    @pytest.mark.asyncio
    async def test_done_turns_the_card_into_a_summary(self, api, linked_store, state):
        message = await self._started(api, linked_store, state)
        await scenarios.meal_toggle(
            FakeCallback(data=f"{keyboards.MEAL_ITEM_PREFIX}item-3", message=message),
            state,
            api,
            linked_store,
            SETTINGS,
        )

        await scenarios.meal_done(
            FakeCallback(data=keyboards.DONE_DATA, message=message), state, linked_store
        )

        assert message.last == texts.MEAL_DONE.format(list="Приём 2: Суп со сливками")
        assert message.last_markup is None
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_plan_changed_shows_the_plan_as_it_is_now(self, api, linked_store, state):
        """409 `plan_changed`: день пересохранили без этого блюда — это не
        «сервис недоступен», а меню, какое оно теперь."""

        message = await self._started(api, linked_store, state)
        api.menu["items"] = [i for i in api.menu["items"] if i["id"] != "item-1"]
        api.eaten_error = BotApiError("conflict", "План изменили", 409, {"reason": "plan_changed"})

        callback = FakeCallback(data=f"{keyboards.MEAL_ITEM_PREFIX}item-1", message=message)
        await scenarios.meal_toggle(callback, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEAL_PLAN_CHANGED
        assert all("Омлет" not in text for text in labels(message.last_markup))
        assert await state.get_state() == scenarios.Meal.choice.state

    @pytest.mark.asyncio
    async def test_no_menu_offers_free_text(self, api, linked_store, state):
        api.menu = None
        message = FakeMessage(text=texts.BTN_MEAL)

        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEAL_NO_MENU
        assert await state.get_state() == scenarios.Meal.choice.state
        assert texts.BTN_MEAL_TEXT in labels(message.last_markup)

    @pytest.mark.asyncio
    async def test_all_eaten_says_so(self, api, linked_store, state):
        api.menu = {"items": [item for item in self.menu()["items"] if item["eaten"]]}
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
    """Лекарства на сегодня — один список с галочками, «Дали» и «Пропустили»."""

    MEDS = [
        {"id": "med-1", "drug_name": "Депакин", "dose": "300 мг"},
        {"id": "med-2", "drug_name": "Топамакс", "dose": "50 мг"},
    ]

    async def _started(self, api, store, state) -> FakeMessage:
        api.medications = self.MEDS
        message = FakeMessage(text=texts.BTN_MEDICATION)
        await scenarios.medication_start(message, state, api, store, SETTINGS)
        return message

    @pytest.mark.asyncio
    async def test_offers_the_schedule_of_the_day(self, api, linked_store, state):
        message = await self._started(api, linked_store, state)

        assert message.last == texts.MEDICATION_ASK
        buttons = labels(message.last_markup)
        assert keyboards.UNMARKED + "Депакин — 300 мг" in buttons
        assert texts.BTN_MEDICATION_GIVEN_ALL in buttons
        assert texts.BTN_MEDICATION_SKIPPED_ALL in buttons

    @pytest.mark.asyncio
    async def test_given_all_is_one_tap_and_one_record_per_medication(
        self, api, linked_store, state
    ):
        message = await self._started(api, linked_store, state)

        callback = FakeCallback(data=keyboards.MEDICATION_GIVEN_DATA, message=message)
        await scenarios.medication_answer(callback, state, api, linked_store, SETTINGS)

        assert [(log["payload"]["medication_id"], log["payload"]["taken"]) for log in api.logs] == [
            ("med-1", True),
            ("med-2", True),
        ]
        assert "Депакин — 300 мг" in message.last and "Топамакс — 50 мг" in message.last
        assert message.sent == 1

    @pytest.mark.asyncio
    async def test_skipped_marked_one_is_written_as_not_taken(self, api, linked_store, state):
        """«Пропустили» — запись `taken: false`: пропуск врачу важен не меньше приёма."""

        message = await self._started(api, linked_store, state)
        await scenarios.medication_toggle(
            FakeCallback(data=f"{keyboards.MEDICATION_PREFIX}med-2", message=message), state
        )
        assert texts.BTN_MEDICATION_SKIPPED.format(count=1) in labels(message.markups[-1])

        callback = FakeCallback(data=keyboards.MEDICATION_SKIPPED_DATA, message=message)
        await scenarios.medication_answer(callback, state, api, linked_store, SETTINGS)

        assert len(api.logs) == 1
        assert api.logs[0]["payload"] == {
            "occurred_at": api.logs[0]["payload"]["occurred_at"],
            "medication_id": "med-2",
            "taken": False,
        }
        assert message.last.startswith("Записано ✓ " + texts.SUMMARY_MEDICATIONS_SKIPPED[:5])

    @pytest.mark.asyncio
    async def test_retry_sends_only_what_did_not_arrive(self, api, linked_store, state):
        message = await self._started(api, linked_store, state)
        api.fail_after = 1
        callback = FakeCallback(data=keyboards.MEDICATION_GIVEN_DATA, message=message)
        await scenarios.medication_answer(callback, state, api, linked_store, SETTINGS)
        # Часть уже в дневнике — и об этом сказано, чтобы не начать заново.
        assert message.last.startswith(texts.NO_CONNECTION)
        assert texts.SAVED_PARTIAL.format(done=1, total=2) in message.last

        api.fail_after = None
        await scenarios.retry(
            FakeCallback(data=keyboards.RETRY_DATA, message=message),
            state,
            api,
            linked_store,
            SETTINGS,
        )

        assert [log["payload"]["medication_id"] for log in api.logs] == ["med-1", "med-2"]

    @pytest.mark.asyncio
    async def test_empty_schedule_explains_who_fills_it(self, api, linked_store, state):
        api.medications = []
        message = FakeMessage(text=texts.BTN_MEDICATION)

        await scenarios.medication_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEDICATION_NONE
        assert await state.get_state() is None


class TestReminderButtons:
    """Кнопка «Записать…» под напоминанием воркера запускает сценарий (ADR-0076)."""

    def test_the_worker_builds_what_the_bot_understands(self):
        from worker.reminders import buttons

        assert buttons.REMINDER_PREFIX == keyboards.REMINDER_PREFIX
        assert set(buttons.REMINDER_ACTIONS.values()) == set(keyboards.REMINDER_KINDS)

    @pytest.mark.asyncio
    async def test_starts_the_scenario_for_the_child_of_the_reminder(
        self, api, linked_store, state
    ):
        reminder = FakeMessage(text="Напоминание")
        callback = FakeCallback(
            data=f"{keyboards.REMINDER_PREFIX}ketones:{PATIENT_ID.hex}", message=reminder
        )

        await scenarios.reminder_start(callback, state, api, linked_store, SETTINGS)

        assert reminder.last == texts.KETONES_ASK_VALUE
        assert await state.get_state() == scenarios.Ketones.value.state
        assert (await state.get_data())["scenario_patient_id"] == str(PATIENT_ID)

    @pytest.mark.asyncio
    async def test_foreign_child_is_refused(self, api, linked_store, state):
        callback = FakeCallback(data=f"{keyboards.REMINDER_PREFIX}weight:{'0' * 32}")

        await scenarios.reminder_start(callback, state, api, linked_store, SETTINGS)

        assert callback.alert == texts.RECORD_CHILD_GONE
        assert await state.get_state() is None


class TestTextOnAButtonStep:
    @pytest.mark.asyncio
    async def test_text_where_a_button_is_expected_says_so(self, api, linked_store, state):
        await state.set_state(scenarios.Seizure.count)
        message = FakeMessage(text="два")

        await fallback.unknown(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.BUTTON_STEP_HINT
        assert await state.get_state() == scenarios.Seizure.count.state

    @pytest.mark.asyncio
    async def test_code_is_not_taken_from_inside_a_scenario(self, api, linked_store, state):
        await state.set_state(scenarios.Medication.choice)
        message = FakeMessage(text="ABCD2345")

        await fallback.unknown(message, state, api, linked_store, SETTINGS)

        assert api.verified_code is None
        assert message.last == texts.BUTTON_STEP_HINT

    @pytest.mark.parametrize("word", ["лекарств", "спасибо!", "дайте ещё"])
    def test_a_russian_word_is_not_a_code(self, word):
        assert not start.looks_like_code(word)

    @pytest.mark.parametrize("code", ["ABCD2345", "abcd 2345", "АВСЕ2345"])
    def test_codes_still_look_like_codes(self, code):
        assert start.looks_like_code(code)


class TestTextsHaveNoMarkup:
    """У бота не задан parse_mode: любые теги Telegram показывает буквально.

    Подсказки времени уже приходили семье как «<code>07:30</code>» — с угловыми
    скобками. Тест закрывает класс ошибки, а не единичный случай.
    """

    def test_no_angle_brackets_in_any_text(self):
        for name in dir(texts):
            value = getattr(texts, name)
            if name.startswith("_") or not isinstance(value, str):
                continue
            assert "<" not in value and ">" not in value, name


class TestMenuAlwaysWins:
    """Кнопка меню посреди сценария — смена намерения, а не ошибка формата.

    До правила поведение зависело от места обработчика в файле: «⚖️ Вес» в шаге
    кетонов получал «Нужно число», а в шаге самочувствия — переключал сценарий.
    """

    def test_button_handlers_are_registered_before_state_steps(self):
        """Порядок регистрации — часть поведения: aiogram берёт первый
        подходящий обработчик, и шаг сценария, стоящий раньше кнопки,
        перехватывает её текст."""

        starts = {
            scenarios.seizure_start,
            scenarios.ketones_start,
            scenarios.weight_start,
            scenarios.medication_start,
            scenarios.meal_start,
            scenarios.wellbeing_start,
        }
        callbacks = [h.callback for h in scenarios.router.message.handlers]
        last_start = max(callbacks.index(fn) for fn in starts)
        first_step = min(callbacks.index(fn) for fn in callbacks if fn not in starts)
        assert last_start < first_step, "обработчики кнопок обязаны стоять раньше шагов сценариев"

    @pytest.mark.asyncio
    async def test_start_drops_the_abandoned_scenario(self, linked_store, state):
        """Начатый и брошенный ввод не должен протекать в новый сценарий."""

        await state.set_state(scenarios.Ketones.method)
        await state.update_data(value="3.2", pending_kind="ketones")

        message = FakeMessage(text=texts.BTN_WEIGHT)
        await scenarios.weight_start(message, state, linked_store)

        assert await state.get_state() == scenarios.Weight.value.state
        data = await state.get_data()
        assert "value" not in data and "pending_kind" not in data, (
            "данные брошенного сценария забыты"
        )
        # Остаётся только отметка, про какого ребёнка начат новый (ADR-0048),
        # и номер её карточки (ADR-0076).
        assert data == {
            "scenario_patient_id": str(PATIENT_ID),
            "scenario_link_id": str(LINK_ID),
            "card_message_id": 1001,
        }


class TestGroupChats:
    """В группе бот молчит: отбойник отвечал бы на каждое видимое сообщение и
    предлагал меню, каждая кнопка которого просила бы код, — а привязка в
    группах запрещена."""

    @pytest.mark.asyncio
    async def test_group_message_is_ignored(self, dispatcher):
        from aiogram import Bot
        from aiogram.dispatcher.event.bases import UNHANDLED
        from aiogram.types import Chat, Message, Update, User

        update = Update(
            update_id=1,
            message=Message(
                message_id=1,
                date=datetime(2026, 9, 1, 12, 0, tzinfo=UTC),
                chat=Chat(id=-100123, type="supergroup"),
                from_user=User(id=7, is_bot=False, first_name="Мама"),
                text="что записать?",
            ),
        )
        bot = Bot(token="42:TEST")
        try:
            result = await dispatcher.feed_update(bot, update)
        finally:
            await bot.session.close()

        assert result is UNHANDLED, "групповое сообщение не должно получать ответ"


class TestHelp:
    def test_more_answers_the_inevitable_questions(self):
        """«Как исправить запись», «где напоминания», «как отключить
        устройство» — ответы ведут туда, где взрослый из Telegram может это
        сделать: в приложение или к тому, кто выдаёт коды."""

        help_text = texts.HELP.lower()
        assert "исправить" in help_text
        assert "раздел «дневник»" in help_text
        assert "блок «напоминания»" in help_text
        assert "закрыть доступ" in help_text
        assert "врача" in help_text
        assert "настраиваются в кабинете" not in help_text
        assert "исправить можно в кабинете" not in help_text

    def test_fix_names_both_ways(self):
        assert texts.BTN_OTHER_TIME.split(" ", 1)[1] in texts.HELP_FIX
        assert "раздел «Дневник»" in texts.HELP_FIX

    def test_cabinet_is_not_promised_the_menu(self):
        assert "меню, отчёты" not in texts.HELP.lower()
        assert "отчёты к приёму" in texts.HELP.lower()

    def test_texts_do_not_send_to_the_cabinet_for_everyday_things(self):
        for text in (texts.LINK_REVOKED, texts.MEAL_TEXT_LIMIT, texts.SEIZURE_NO_TYPES):
            assert "кабинет" not in text.lower()
        assert "код" in texts.LINK_REVOKED

    @pytest.mark.asyncio
    async def test_help_button_answers_short_with_buttons(self, state):
        message = FakeMessage(text=texts.BTN_HELP)
        await state.set_state(scenarios.Ketones.value)

        await start.help_command(message, state, SETTINGS, FakeStore())

        assert await state.get_state() is None, "кнопка меню закрывает начатую запись"
        assert len(message.last.splitlines()) <= 4
        buttons = labels(message.last_markup)
        assert texts.BTN_LANGUAGE in buttons
        assert texts.BTN_HELP_FIX in buttons
        assert texts.BTN_OPEN_APP not in buttons, "без адреса приложения кнопки нет"

    @pytest.mark.asyncio
    async def test_help_opens_the_app_when_it_exists(self, state):
        with_app = BotSettings(
            bot_token="t", bot_api_token="s", miniapp_url="https://tma.example.uz"
        )
        message = FakeMessage(text="/help")
        await start.help_command(message, state, with_app, FakeStore())

        app = next(
            b for row in message.last_markup.inline_keyboard for b in row if b.web_app is not None
        )
        assert app.web_app.url == "https://tma.example.uz"
        assert app.style == "primary"

    @pytest.mark.asyncio
    async def test_help_buttons_edit_the_same_message(self):
        message = FakeMessage()
        await start.help_button(
            FakeCallback(data=keyboards.HELP_FIX_DATA, message=message), SETTINGS
        )
        assert message.last == texts.HELP_FIX
        await start.help_button(
            FakeCallback(data=keyboards.HELP_LANGUAGE_DATA, message=message), SETTINGS
        )
        assert message.last == texts.LANGUAGE_ASK
        assert message.sent == 0

    @pytest.mark.asyncio
    async def test_help_is_silent_in_groups(self, state):
        message = FakeMessage(text="/help", chat=FakeChat(id=-100123, type="supergroup"))
        await start.help_command(message, state, SETTINGS, FakeStore())
        assert message.answers == []


class TestGroupStart:
    @pytest.mark.asyncio
    async def test_start_in_a_group_is_explained_once(self, state):
        store = FakeStore()
        for _ in range(2):
            message = FakeMessage(text="/start", chat=FakeChat(id=-100500, type="group"))
            await start.start_without_code(message, state, store, SETTINGS)
        assert message.answers == []

        first = FakeMessage(text="/start", chat=FakeChat(id=-100600, type="group"))
        await start.start_without_code(first, state, store, SETTINGS)
        assert first.last == texts.GROUP_ONLY_PRIVATE


class TestBotProfile:
    """Команды и описания — то, что родитель видит до первого сообщения."""

    @pytest.mark.asyncio
    async def test_profile_is_registered(self):
        from bot import main as bot_main

        class FakeBot:
            def __init__(self):
                self.commands = None
                self.description = None
                self.short_description = None

            async def set_my_commands(self, commands, language_code=None):
                if language_code is None:
                    self.commands = commands
                else:
                    self.uz_commands = commands

            async def set_my_description(self, *, description, language_code=None):
                if language_code is None:
                    self.description = description
                else:
                    self.uz_description = description

            async def set_my_short_description(self, *, short_description, language_code=None):
                if language_code is None:
                    self.short_description = short_description

            async def set_chat_menu_button(self, *, menu_button):
                self.menu_button = menu_button

        bot = FakeBot()
        await bot_main.setup_bot_profile(bot, SETTINGS)

        assert {c.command for c in bot.commands} == {"start", "help", "language"}
        assert all(c.description for c in bot.commands)
        assert bot.description and bot.short_description
        # Узбекский профиль для клиентов с узбекским интерфейсом (ADR-0052).
        assert {c.command for c in bot.uz_commands} == {"start", "help", "language"}
        assert bot.uz_description != bot.description

    @pytest.mark.asyncio
    async def test_profile_failure_does_not_break_startup(self):
        """Косметика не должна ронять запуск: без описания бот хуже выглядит,
        но работает."""

        from bot import main as bot_main

        class BrokenBot:
            async def set_my_commands(self, commands):
                raise RuntimeError("telegram is down")

        await bot_main.setup_bot_profile(BrokenBot(), SETTINGS)


class TestCancelOnOldMessage:
    @pytest.mark.asyncio
    async def test_cancel_survives_an_inaccessible_message(self, state):
        """«Отмена» на сообщении старше 48 часов: Telegram отдаёт
        InaccessibleMessage без метода answer, и единственный обработчик,
        бравший message без проверки, падал молча для семьи."""

        from aiogram.types import Chat, InaccessibleMessage

        await state.set_state(scenarios.Ketones.value)
        callback = FakeCallback(
            data=keyboards.CANCEL_DATA,
            message=InaccessibleMessage(
                chat=Chat(id=CHAT_ID, type="private"), message_id=1, date=0
            ),
        )
        await scenarios.cancel(callback, state)

        assert callback.answered
        assert await state.get_state() is None


class TestConfirmationTime:
    """Эхо называет время так, как его понимает семья."""

    def test_just_now(self):
        assert deps.when_text(None, tz="Asia/Tashkent") == texts.WHEN_JUST_NOW

    def test_today(self, monkeypatch):
        monkeypatch.setattr(deps, "datetime", frozen(datetime(2026, 8, 31, 12, 0, tzinfo=UTC)))
        moment = datetime(2026, 8, 31, 2, 30, tzinfo=UTC)  # 07:30 по Ташкенту
        assert deps.when_text(moment, tz="Asia/Tashkent") == "сегодня в 07:30"

    def test_another_day_keeps_the_date(self, monkeypatch):
        monkeypatch.setattr(deps, "datetime", frozen(datetime(2026, 8, 31, 12, 0, tzinfo=UTC)))
        moment = datetime(2026, 8, 29, 16, 0, tzinfo=UTC)  # 21:00 по Ташкенту
        assert deps.when_text(moment, tz="Asia/Tashkent") == "29.08 в 21:00"


class TestStateFromBeforeTheDeploy:
    """Состояние FSM живёт в Redis и переживает выкат.

    Семья, дошедшая до шага «Когда это было?» на прежней версии бота, нажмёт
    «Сейчас» уже на новой — и в её сохранённых данных нет `pending_summary`.
    Запись обязана уйти: потерять клиническую запись ради эха нельзя.
    """

    @pytest.mark.asyncio
    async def test_record_without_a_summary_is_still_sent(self, api, linked_store, state):
        await state.set_state(scenarios.When.choice)
        # Ровно то, что записала в состояние прежняя версия: без summary.
        await state.update_data(pending_kind="weight", pending_payload={"weight_kg": "18.4"})

        message = FakeMessage()
        callback = FakeCallback(data=keyboards.WHEN_NOW_DATA, message=message)
        await scenarios.when_now(callback, state, api, linked_store, SETTINGS)

        assert len(api.logs) == 1, "запись из состояния прежней версии не должна теряться"
        assert api.logs[0]["payload"]["weight_kg"] == "18.4"
        assert message.last == texts.SAVED_BARE
        assert await state.get_state() is None
