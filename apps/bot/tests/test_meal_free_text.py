"""«Еда → свободный текст» в боте (раздел 10.3 ТЗ, п. 19 этапа 4).

Разбор — предположение модели о том, что съел ребёнок, а по нему считается
кетосоотношение. Поэтому проверяется не «сценарий проходит», а границы: что
показано человеку до записи, что уходит на сервер и что происходит, когда
разбора нет.
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

JOB_ID = str(uuid.uuid4())

PARSED = {
    "ai_job_id": JOB_ID,
    "kind": "meal",
    "meal": {
        "items": [
            {
                "product_id": str(uuid.uuid4()),
                "grams": 30.0,
                "confidence": 1.0,
                "name_ru": "Масло сливочное",
            },
            {
                "product_id": str(uuid.uuid4()),
                "grams": 55.0,
                "confidence": 0.7,
                "name_ru": "Яйцо куриное",
            },
        ],
        "unmatched": [],
    },
    "seizure": None,
    "clarification_needed": None,
}


async def _to_text_step(api, store, state) -> FakeMessage:
    """Довести сценарий до шага ввода фразы."""

    callback = FakeCallback(data=keyboards.MEAL_TEXT_DATA)
    await state.set_state(scenarios.Meal.choice)
    await scenarios.meal_text_start(callback, state)
    return callback.message


class TestDraftBeforeSaving:
    @pytest.mark.asyncio
    async def test_parse_saves_nothing(self, api, linked_store, state):
        """Разбор — черновик. Пока родитель не нажал «Подтвердить», в дневнике
        не должно появиться ничего (правило 6 CLAUDE.md)."""

        api.parsed = PARSED
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="30 г масла и одно яйцо")

        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        assert api.logs == []
        assert await state.get_state() == scenarios.Meal.confirm.state

    @pytest.mark.asyncio
    async def test_draft_names_products_and_marks_guesses(self, api, linked_store, state):
        """Родитель проверяет по названию и видит, где граммовка — оценка.
        «3f2a1c9d… 30 г» проверить нельзя, а подтверждение без проверки — это
        кнопка «согласен», а не человек в контуре."""

        api.parsed = PARSED
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="30 г масла и одно яйцо")

        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        draft = message.last
        assert "Масло сливочное — 30 г" in draft
        # confidence 0.7 — модель сама сказала, что не уверена.
        assert "Яйцо куриное — примерно 55 г" in draft

    @pytest.mark.asyncio
    async def test_unmatched_products_are_named(self, api, linked_store, state):
        """Без этой строки родитель решил бы, что записан весь приём пищи."""

        api.parsed = {
            **PARSED,
            "meal": {"items": PARSED["meal"]["items"], "unmatched": ["супчик"]},
        }
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="масло, яйцо и супчик")

        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        assert "супчик" in message.last
        assert "в расчёт не войдут" in message.last


class TestConfirmation:
    @pytest.mark.asyncio
    async def test_confirm_sends_the_job_id_not_the_structure(self, api, linked_store, state):
        """На сервер уходит идентификатор разбора: структуру он берёт из своего
        журнала. Иначе бот мог бы прислать под видом разбора что угодно."""

        api.parsed = PARSED
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="30 г масла и одно яйцо")
        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        callback = FakeCallback(data=keyboards.CONFIRM_DATA)
        await scenarios.meal_text_confirm(callback, state, api, linked_store, SETTINGS)

        assert len(api.logs) == 1
        payload = api.logs[0]["payload"]
        assert api.logs[0]["kind"] == "meals"
        assert payload["ai_job_id"] == JOB_ID
        assert payload["free_text"] == "30 г масла и одно яйцо"
        assert "parsed" not in payload
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_confirmation_echoes_what_was_saved(self, api, linked_store, state):
        """Эхо, а не голое «Записано ✓»: два подтверждения подряд иначе
        неотличимы, и опечатку в граммовке не заметить."""

        api.parsed = PARSED
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="30 г масла и одно яйцо")
        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        callback = FakeCallback(data=keyboards.CONFIRM_DATA)
        await scenarios.meal_text_confirm(callback, state, api, linked_store, SETTINGS)

        assert "Масло сливочное 30 г" in callback.message.last

    @pytest.mark.asyncio
    async def test_confirm_without_a_draft_does_not_write(self, api, linked_store, state):
        """Состояние могло пережить перезапуск бота: подтверждать нечего, и
        придумывать запись на пустом месте нельзя."""

        await state.set_state(scenarios.Meal.confirm)
        callback = FakeCallback(data=keyboards.CONFIRM_DATA)

        await scenarios.meal_text_confirm(callback, state, api, linked_store, SETTINGS)

        assert api.logs == []
        assert await state.get_state() is None


class TestWhenParsingFails:
    @pytest.mark.asyncio
    async def test_question_from_the_model_is_shown_and_the_step_stays(
        self, api, linked_store, state
    ):
        """«Поел кашу» — это вопрос родителю, а не отказ: он допишет и пришлёт
        снова, не начиная сценарий заново."""

        api.parsed = {
            "ai_job_id": JOB_ID,
            "kind": "meal",
            "meal": {"items": [], "unmatched": ["каша"]},
            "seizure": None,
            "clarification_needed": "Из чего была каша и сколько ребёнок съел?",
        }
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="поел кашу")

        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        assert "Из чего была каша" in message.last
        assert api.logs == []
        assert await state.get_state() == scenarios.Meal.text.state

    @pytest.mark.asyncio
    async def test_limit_says_so_and_offers_the_plan(self, api, linked_store, state):
        """Предел ИИ — это «на сегодня хватит», а не «сломалось»: следующее
        действие человека разное (раздел 10.2 ТЗ)."""

        api.parse_error = BotApiError("rate_limited", "Лимит исчерпан.", 429)
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="30 г масла")

        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEAL_TEXT_LIMIT
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_unavailable_degrades_to_the_plan(self, api, linked_store, state):
        """Мягкая деградация раздела 10.2: разбора нет — план дня работает."""

        api.parse_error = BotApiError("internal", "Недоступно.", 503)
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="30 г масла")

        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEAL_TEXT_UNAVAILABLE
        assert "по плану" in message.last

    @pytest.mark.asyncio
    async def test_revoked_link_ends_the_scenario(self, api, linked_store, state):
        """Секрет перестал работать — запись не уйдёт никогда, и держать
        сценарий открытым бессмысленно."""

        api.parse_error = LinkRevokedError("forbidden", "Привязка отозвана.", 403)
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="30 г масла")

        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.LINK_REVOKED
        assert await linked_store.get(message.chat.id) is None
        assert await state.get_state() is None

    @pytest.mark.asyncio
    async def test_empty_message_is_asked_again(self, api, linked_store, state):
        await _to_text_step(api, linked_store, state)
        message = FakeMessage(text="   ")

        await scenarios.meal_text_parse(message, state, api, linked_store, SETTINGS)

        assert message.last == texts.MEAL_TEXT_EMPTY
        assert api.parsed_texts == []
        assert await state.get_state() == scenarios.Meal.text.state


class TestTimeoutMatchesTheEndpoint:
    def test_parse_waits_longer_than_the_endpoint(self) -> None:
        """Находка ревью: общий таймаут клиента (10 с) короче, чем ждёт ручка
        разбора (15 с). Родитель не увидел бы ничего: `httpx.ReadTimeout` — не
        `BotApiError`, и до сообщения об отказе обработчик не дошёл бы."""

        from api.routers.ai import PARSE_TIMEOUT_S as ENDPOINT_WAIT
        from bot.api import PARSE_TIMEOUT_S as BOT_WAIT

        assert BOT_WAIT > ENDPOINT_WAIT

    @pytest.mark.asyncio
    async def test_parse_request_carries_its_own_timeout(self) -> None:
        """Своё ожидание — только у разбора: остальные вызовы должны падать
        быстро, а не ждать шестнадцать секунд молчащего сервера."""

        import httpx

        from bot.api import PARSE_TIMEOUT_S, BotApi

        seen: dict[str, object] = {}

        async def handler(request: httpx.Request) -> httpx.Response:
            seen["timeout"] = request.extensions.get("timeout")
            if request.url.path.endswith("/auth/bot/session"):
                return httpx.Response(200, json={"access_token": "t", "expires_in": 900})
            return httpx.Response(200, json={"ai_job_id": str(uuid.uuid4()), "kind": "other"})

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://api", timeout=10.0
        ) as http:
            api = BotApi(http, service_token="s")
            await api.parse_text(
                link_id=uuid.uuid4(),
                secret="secret",
                patient_id=uuid.uuid4(),
                text="30 г масла",
            )

        assert seen["timeout"] == {
            "connect": PARSE_TIMEOUT_S,
            "read": PARSE_TIMEOUT_S,
            "write": PARSE_TIMEOUT_S,
            "pool": PARSE_TIMEOUT_S,
        }
