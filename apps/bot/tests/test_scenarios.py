"""Сценарии ввода и привязка (раздел 7 ТЗ).

Обработчики вызываются напрямую с поддельными Message/CallbackQuery: проверяется
наша логика — валидация, переходы состояний, форма запроса к API, поведение при
отзыве привязки, — а не сеть Telegram.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.fsm.storage.memory import MemoryStorage

from bot import deps, keyboards, texts
from bot.api import BotApiError, LinkRevokedError
from bot.config import BotSettings
from bot.handlers import fallback, scenarios, start

from .conftest import CHAT_ID, LINK_ID, PATIENT_ID, PATIENT_NAME, SECRET

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
    await scenarios.when_now(callback, state, api, store, SETTINGS)


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

        await start._link(message, api=api, store=store, settings=SETTINGS, code="ABCD2345")

        assert PATIENT_NAME in message.last
        binding = await store.get(CHAT_ID)
        assert binding is not None
        assert binding.secret == SECRET, "секрет обязан сохраниться: восстановить его нельзя"

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

        assert "15 минут" in message.last
        assert await store.get(CHAT_ID) is None

    @pytest.mark.asyncio
    async def test_busy_chat_tells_to_unlink_first(self, api, store):
        api.verify_error = BotApiError("conflict", "занято", 409)
        message = FakeMessage()

        await start._link(message, api=api, store=store, settings=SETTINGS, code="ABCD2345")

        assert message.last == texts.LINK_CHAT_BUSY

    @pytest.mark.asyncio
    async def test_bare_code_is_treated_as_a_code_not_as_chatter(self, api, store):
        """Родитель с компьютера переписывает код руками, а не жмёт ссылку."""

        message = FakeMessage(text="ABCD2345")

        await fallback.unknown(message, api=api, store=store, settings=SETTINGS)

        assert PATIENT_NAME in message.last
        assert await store.get(CHAT_ID) is not None

    @pytest.mark.asyncio
    async def test_chatter_gets_the_standard_answer(self, api, linked_store):
        """Раздел 7.5: бот не поддерживает беседу и не отвечает на вопросы."""

        message = FakeMessage(text="а какое соотношение у моего ребёнка?")

        await fallback.unknown(message, api=api, store=linked_store, settings=SETTINGS)

        # SETTINGS без MINIAPP_URL: обещать «откройте приложение» нельзя —
        # кнопки приложения в меню нет.
        assert message.last == texts.UNKNOWN_INPUT_NO_APP

    @pytest.mark.asyncio
    async def test_chatter_with_app_is_pointed_to_the_app(self, api, linked_store):
        with_app = BotSettings(
            bot_token="t", bot_api_token="s", miniapp_url="https://tma.example.uz"
        )
        message = FakeMessage(text="что поесть?")

        await fallback.unknown(message, api=api, store=linked_store, settings=with_app)

        assert message.last == texts.UNKNOWN_INPUT

    @pytest.mark.asyncio
    async def test_unlinked_chatter_is_told_how_to_link(self, api, store):
        """Непривязанному — про привязку: его следующий шаг — код, а не кнопки."""

        message = FakeMessage(text="здравствуйте")

        await fallback.unknown(message, api=api, store=store, settings=SETTINGS)

        assert message.last == texts.NOT_LINKED

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
        # Эхо повторяет запись: без него не заметить опечатку 32 вместо 3,2.
        confirmation = callback.message.last
        assert confirmation.startswith("Записано ✓")
        assert "3,2" in confirmation and "ммоль/л" in confirmation and "кровь" in confirmation
        assert texts.WHEN_JUST_NOW in confirmation
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
        assert message.last.startswith("Записано ✓")
        assert "18,4" in message.last and "кг" in message.last


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

        await scenarios.cancel(callback, state, SETTINGS)

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
        """Состав меню проверяется, а не подразумевается.

        Раздел 7.2 перечисляет семь кнопок, в меню шесть: «Приступ» убран до
        ответа медкоманды о шкале длительности (вопрос 23) — см.
        `TestSeizureButton`. Отступление намеренное, и заметить его должен этот
        тест, а не семья.
        """

        with_app = BotSettings(
            bot_token="t", bot_api_token="s", miniapp_url="https://tma.example.uz"
        )
        labels = {button.text for row in keyboards.main_menu(with_app).keyboard for button in row}
        assert labels == {
            texts.BTN_KETONES,
            texts.BTN_WEIGHT,
            texts.BTN_MEAL,
            texts.BTN_MEDICATION,
            texts.BTN_WELLBEING,
            texts.BTN_APP,
        }

    def test_app_button_opens_the_mini_app(self):
        """Кнопка обязана нести адрес: без `web_app` она просто текст, и
        Telegram ничего не откроет."""

        settings = BotSettings(
            bot_token="t", bot_api_token="s", miniapp_url="https://tma.example.uz"
        )
        buttons = [b for row in keyboards.main_menu(settings).keyboard for b in row]
        app_button = next(b for b in buttons if b.text == texts.BTN_APP)

        assert app_button.web_app is not None
        assert app_button.web_app.url == "https://tma.example.uz"

    def test_app_button_is_absent_until_the_mini_app_is_deployed(self):
        """Кнопка, которая никуда не ведёт, хуже отсутствующей.

        Хуже буквально: Telegram отвергает `web_app` с пустым или http-адресом,
        и тогда не приходит ВСЁ сообщение — то есть меню исчезает целиком.
        """

        labels = {b.text for row in keyboards.main_menu(SETTINGS).keyboard for b in row}
        assert texts.BTN_APP not in labels

    def test_http_address_is_not_offered_to_telegram(self):
        # Telegram принимает в `web_app` только https.
        insecure = BotSettings(
            bot_token="t", bot_api_token="s", miniapp_url="http://tma.example.uz"
        )
        labels = {b.text for row in keyboards.main_menu(insecure).keyboard for b in row}
        assert texts.BTN_APP not in labels


class TestSeizureButton:
    """Кнопка «Приступ»: в меню её нет, нажатие старой — обрабатывается.

    Сценарий ждёт ответа медкоманды (вопрос 23), но кнопка в меню оставалась и
    приводила в общий отбойник «Я умею записывать данные». То есть на самом
    важном событии бот отвечал так, будто не понял слова.
    """

    def test_menu_does_not_promise_what_the_bot_cannot_do(self):
        labels = {b.text for row in keyboards.main_menu(SETTINGS).keyboard for b in row}
        assert texts.BTN_SEIZURE not in labels

    @pytest.mark.asyncio
    async def test_old_button_is_told_where_to_record(self, state):
        """ReplyKeyboard живёт на устройстве: у семьи кнопка ещё на экране."""

        message = FakeMessage(text=texts.BTN_SEIZURE)

        await scenarios.seizure_not_here(message, state, SETTINGS)

        assert "Дневники" in message.last and "Приступы" in message.last
        assert message.last != texts.UNKNOWN_INPUT

    @pytest.mark.asyncio
    async def test_answer_replaces_the_stale_keyboard(self, state):
        """Иначе кнопка останется на экране и будет нажата снова."""

        message = FakeMessage(text=texts.BTN_SEIZURE)

        await scenarios.seizure_not_here(message, state, SETTINGS)

        _, markup = message.answers[-1]
        assert markup is not None, "ответ без клавиатуры оставляет старую на экране"
        labels = {b.text for row in markup.keyboard for b in row}
        assert labels and texts.BTN_SEIZURE not in labels

    def test_handler_stands_between_the_button_and_the_fallback(self):
        """Обработчик зарегистрирован в `scenarios` и ловит именно эту кнопку.

        Без проверки фильтра тест прошёл бы и на обработчике, до которого
        нажатие не доходит: `fallback` подключён последним и разберёт всё, что
        не поймали сценарии.
        """

        handlers = [
            h for h in scenarios.router.message.handlers if h.callback is scenarios.seizure_not_here
        ]
        assert len(handlers) == 1

        matches = handlers[0].filters[0].callback
        assert matches(SimpleNamespace(text=texts.BTN_SEIZURE))
        assert not matches(SimpleNamespace(text=texts.BTN_KETONES))


class TestEventTimeStep:
    """Время события задаёт семья, а не момент отправки.

    Родитель, записывающий вечером утренний замер, сдвигал его на десять часов —
    а по времени замеров врач судит о динамике.
    """

    @pytest.mark.asyncio
    async def test_manual_time_is_sent_instead_of_now(self, api, linked_store, state, monkeypatch):
        # Часы обработчика подменяются, а не берутся настоящие. С настоящими
        # тест зависел от времени суток: «07:30» до половины восьмого утра — это
        # будущее, бот отвечал «время ещё не наступило», записи не было, и
        # прогон падал ночью. Ровно так `main` покраснел в 00:02 по Ташкенту.
        moment = frozen(datetime(2026, 8, 31, 12, 0, tzinfo=UTC))
        monkeypatch.setattr(scenarios, "datetime", moment)
        # Эхо подтверждения сравнивает введённое время с «сегодня» — часы
        # модуля deps замораживаются те же, иначе тест зависит от даты прогона.
        monkeypatch.setattr(deps, "datetime", moment)

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
        assert typed.last.startswith("Записано ✓")
        # Эхо называет время, которое ввела семья, — по её же часам.
        assert texts.WHEN_TODAY_AT.format(time="07:30") in typed.last

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

    @staticmethod
    def menu() -> dict[str, Any]:
        # Свежий словарь на каждый тест: FakeApi.mark_eaten помечает позиции
        # прямо в меню, и общий словарь класса протёк бы между тестами.
        return {
            "items": [
                {
                    "id": "item-1",
                    "meal_slot": "breakfast",
                    "title": "Омлет с маслом",
                    "eaten": False,
                },
                {
                    "id": "item-3",
                    "meal_slot": "lunch",
                    "title": "Суп со сливками",
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
        api.menu = self.menu()
        message = FakeMessage(text=texts.BTN_MEAL)

        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEAL_ASK
        buttons = [button.text for row in message.answers[-1][1].inline_keyboard for button in row]
        assert "Завтрак: Омлет с маслом" in buttons
        assert all("Курица" not in text for text in buttons), "съеденное не предлагается"

    @pytest.mark.asyncio
    async def test_mark_offers_the_rest_of_the_plan(self, api, linked_store, state):
        """Завтрак из двух блюд — два нажатия подряд, а не два захода через меню."""

        api.menu = self.menu()
        message = FakeMessage(text=texts.BTN_MEAL)
        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        callback = FakeCallback(data=f"{keyboards.MEAL_ITEM_PREFIX}item-1", message=message)
        await scenarios.meal_mark(callback, state, api, linked_store, SETTINGS)

        assert api.eaten == ["item-1"]
        # Эхо называет отмеченное блюдо, ниже — остаток плана.
        assert "Омлет с маслом" in message.last
        buttons = [b.text for row in message.answers[-1][1].inline_keyboard for b in row]
        assert "Обед: Суп со сливками" in buttons
        # Выход из серии — «Готово», не «Отмена»: отметки уже сохранены.
        assert texts.BTN_DONE in buttons
        assert texts.BTN_CANCEL not in buttons
        assert await state.get_state() == scenarios.Meal.choice.state

    @pytest.mark.asyncio
    async def test_last_mark_closes_the_day(self, api, linked_store, state):
        api.menu = self.menu()
        message = FakeMessage(text=texts.BTN_MEAL)
        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        for item_id in ("item-1", "item-3"):
            callback = FakeCallback(data=f"{keyboards.MEAL_ITEM_PREFIX}{item_id}", message=message)
            await scenarios.meal_mark(callback, state, api, linked_store, SETTINGS)

        assert api.eaten == ["item-1", "item-3"]
        assert message.last == texts.MEAL_MARKED_LAST.format(title="Обед: Суп со сливками")
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_done_ends_the_series_without_the_word_cancel(self, api, linked_store, state):
        api.menu = self.menu()
        message = FakeMessage(text=texts.BTN_MEAL)
        await scenarios.meal_start(message, state, api, linked_store, SETTINGS)

        callback = FakeCallback(data=keyboards.DONE_DATA, message=message)
        await scenarios.meal_done(callback, state, SETTINGS)

        assert message.last == texts.MENU_PROMPT
        assert texts.CANCELLED not in message.last
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
        # Эхо называет препарат: после трёх одинаковых «Записано ✓» подряд
        # не вспомнить, что уже отмечено, — а принимают обычно 2-3 препарата.
        assert "Депакин — 300 мг" in message.last

    @pytest.mark.asyncio
    async def test_empty_schedule_explains_who_fills_it(self, api, linked_store, state):
        api.medications = []
        message = FakeMessage(text=texts.BTN_MEDICATION)

        await scenarios.medication_start(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEDICATION_NONE
        assert await state.get_state() is None


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
            scenarios.seizure_not_here,
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
        assert await state.get_data() == {}, "данные брошенного сценария забыты"

    @pytest.mark.asyncio
    async def test_old_seizure_button_also_drops_the_scenario(self, state):
        """Ответ приходит с главным меню — значит, сценарий закончен, и
        оставленное состояние съело бы следующее сообщение родителя."""

        await state.set_state(scenarios.Wellbeing.symptom)

        message = FakeMessage(text=texts.BTN_SEIZURE)
        await scenarios.seizure_not_here(message, state, SETTINGS)

        assert await state.get_state() is None


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
    def test_help_answers_the_two_inevitable_questions(self):
        """«Как исправить запись» и «как отвязать чат» — оба ответа в кабинете."""

        assert "исправить" in texts.HELP.lower()
        assert "отвязать" in texts.HELP.lower()
        assert "дневники" in texts.HELP.lower()

    @pytest.mark.asyncio
    async def test_help_promises_the_app_only_when_it_exists(self):
        message = FakeMessage(text="/help")
        await start.help_command(message, SETTINGS)
        assert "Приложение" not in message.last

        with_app = BotSettings(
            bot_token="t", bot_api_token="s", miniapp_url="https://tma.example.uz"
        )
        message = FakeMessage(text="/help")
        await start.help_command(message, with_app)
        assert "Приложение" in message.last

    @pytest.mark.asyncio
    async def test_help_is_silent_in_groups(self):
        message = FakeMessage(text="/help", chat=FakeChat(id=-100123, type="supergroup"))
        await start.help_command(message, SETTINGS)
        assert message.answers == []


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

            async def set_my_commands(self, commands):
                self.commands = commands

            async def set_my_description(self, *, description):
                self.description = description

            async def set_my_short_description(self, *, short_description):
                self.short_description = short_description

        bot = FakeBot()
        await bot_main.setup_bot_profile(bot)

        assert {c.command for c in bot.commands} == {"start", "help"}
        assert all(c.description for c in bot.commands)
        assert bot.description and bot.short_description

    @pytest.mark.asyncio
    async def test_profile_failure_does_not_break_startup(self):
        """Косметика не должна ронять запуск: без описания бот хуже выглядит,
        но работает."""

        from bot import main as bot_main

        class BrokenBot:
            async def set_my_commands(self, commands):
                raise RuntimeError("telegram is down")

        await bot_main.setup_bot_profile(BrokenBot())


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
        await scenarios.cancel(callback, state, SETTINGS)

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
