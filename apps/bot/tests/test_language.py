"""Узбекский язык бота (ADR-0052, решение заказчика G3).

Три вещи, которые ломаются молча, если за ними не следить:

* **паритет каталогов** — пропущенное имя или лишняя `{переменная}` в
  узбекском каталоге всплыли бы `AttributeError`/`KeyError` посреди записи
  приступа, и только у узбекской семьи;
* **кнопки на прежнем языке** — клавиатура, отправленная до смены языка,
  остаётся у человека на экране, и её нажатия обязаны работать;
* **язык — свойство человека**: выбор уходит на сервер, а сервер побеждает
  умолчание из Telegram.
"""

from __future__ import annotations

import re
import time
from dataclasses import replace
from string import Formatter
from types import ModuleType
from typing import Any

import pytest
from aiogram.fsm.context import FSMContext

from bot import i18n, keyboards, language, texts, texts_ru, texts_uz
from bot.api import BotApiError
from bot.handlers import fallback, scenarios, start
from bot.storage import StoredLanguage

from .conftest import CHAT_ID
from .test_scenarios import SETTINGS, FakeCallback, FakeMessage

#: Кнопка языка, вопрос и описание команды — двуязычные намеренно и потому
#: содержат кириллицу и в узбекском каталоге.
BILINGUAL = {"BTN_LANGUAGE", "LANGUAGE_ASK", "CMD_LANGUAGE_DESCRIPTION"}


def public(module: ModuleType) -> dict[str, Any]:
    return {
        name: value
        for name, value in vars(module).items()
        if not name.startswith("_") and name != "annotations"
    }


def placeholders(template: str) -> set[str]:
    return {name for _, name, _, _ in Formatter().parse(template) if name is not None}


def labels(markup: Any) -> list[str]:
    rows = getattr(markup, "keyboard", None) or getattr(markup, "inline_keyboard", None) or []
    return [button.text for row in rows for button in row]


class TestCatalogParity:
    def test_same_names(self) -> None:
        assert set(public(texts_uz)) == set(public(texts_ru))

    @pytest.mark.parametrize("name", sorted(public(texts_ru)))
    def test_same_kind_and_placeholders(self, name: str) -> None:
        ru, uz = getattr(texts_ru, name), getattr(texts_uz, name)
        assert type(ru) is type(uz), name
        if isinstance(ru, str):
            assert placeholders(uz) == placeholders(ru), name
        if isinstance(ru, dict):
            assert set(uz) == set(ru), name

    def test_meal_name_is_numbered_in_both(self) -> None:
        assert texts_ru.meal_name(2) == "Приём 2"
        assert texts_uz.meal_name(2) == "2-ovqatlanish"

    def test_no_markup_in_any_language(self) -> None:
        for catalog in i18n.CATALOGS.values():
            for name, value in public(catalog).items():
                if isinstance(value, str):
                    assert "<" not in value and ">" not in value, name

    def test_uzbek_is_latin(self) -> None:
        cyrillic = re.compile(r"[Ѐ-ӿ]")
        found = [
            name
            for name, value in public(texts_uz).items()
            # Подпись кнопки языка, названная в тексте (справка), — тоже двуязычная.
            if isinstance(value, str)
            and name not in BILINGUAL
            and cyrillic.search(value.replace(texts_uz.BTN_LANGUAGE, ""))
        ]
        assert found == []

    def test_language_button_is_the_same_in_every_language(self) -> None:
        """Её ищет тот, кто не читает языка, на котором бот сейчас говорит."""

        assert len(i18n.variants("BTN_LANGUAGE")) == 1
        assert "Til" in texts_ru.BTN_LANGUAGE and "Язык" in texts_ru.BTN_LANGUAGE


class TestTextsFollowTheLanguage:
    def test_default_is_russian(self) -> None:
        assert texts.SAVED == texts_ru.SAVED

    def test_inside_uzbek_context(self) -> None:
        with i18n.use("uz"):
            assert texts.SAVED == texts_uz.SAVED
            assert texts.KETONE_METHOD_NAMES["blood"] == "qon"
        assert texts.SAVED == texts_ru.SAVED, "язык не протекает за пределы обновления"

    def test_main_menu_is_built_in_the_current_language(self) -> None:
        with i18n.use("uz"):
            menu = keyboards.main_menu(SETTINGS)
        assert texts_uz.BTN_WEIGHT in labels(menu)
        assert texts_ru.BTN_LANGUAGE in labels(menu)

    def test_from_telegram(self) -> None:
        assert i18n.from_telegram("uz") == "uz"
        assert i18n.from_telegram("uz-UZ") == "uz"
        assert i18n.from_telegram("ru") == "ru"
        assert i18n.from_telegram("en") == "ru"
        assert i18n.from_telegram(None) == "ru"


async def _matches(router: Any, callback_name: str, text: str) -> bool:
    for handler in router.message.handlers:
        if handler.callback.__name__ == callback_name:
            ok, _ = await handler.check(FakeMessage(text=text))
            return bool(ok)
    raise AssertionError(f"обработчик {callback_name} не найден")


@pytest.mark.asyncio
class TestButtonsInAnyLanguage:
    """Клавиатура на прежнем языке остаётся на экране и обязана работать."""

    @pytest.mark.parametrize(
        ("name", "handler"),
        [
            ("BTN_SEIZURE", "seizure_start"),
            ("BTN_KETONES", "ketones_start"),
            ("BTN_WEIGHT", "weight_start"),
            ("BTN_MEAL", "meal_start"),
            ("BTN_MEDICATION", "medication_start"),
            ("BTN_WELLBEING", "wellbeing_start"),
        ],
    )
    async def test_menu_button(self, name: str, handler: str) -> None:
        for catalog in i18n.CATALOGS.values():
            assert await _matches(scenarios.router, handler, getattr(catalog, name))

    async def test_child_button(self) -> None:
        assert await _matches(start.router, "child_menu", texts_uz.BTN_CHILD.format(name="Anvar"))
        assert await _matches(start.router, "child_menu", texts_ru.BTN_CHILD.format(name="Аня"))

    async def test_language_button(self) -> None:
        assert await _matches(start.router, "language_menu", texts_ru.BTN_LANGUAGE)


@pytest.mark.asyncio
class TestChoosingTheLanguage:
    async def test_question_offers_each_language_in_itself(self, state: FSMContext) -> None:
        message = FakeMessage(text=texts_ru.BTN_LANGUAGE)

        await start.language_menu(message, state)

        assert message.last == texts_ru.LANGUAGE_ASK
        assert labels(message.last_markup) == ["✓ Русский", "O‘zbekcha"]

    async def test_linked_chat_saves_the_choice_on_the_server(
        self, api, linked_store, state: FSMContext
    ) -> None:
        callback = FakeCallback(data=f"{keyboards.LANGUAGE_PREFIX}uz")

        with i18n.use("ru"):
            await start.language_chosen(callback, state, api, linked_store, SETTINGS)

        assert api.language_writes == ["uz"]
        # Подтверждение — уже по-узбекски, и меню под ним — узбекское.
        assert callback.message.last == texts_uz.LANGUAGE_CHOSEN
        assert texts_uz.BTN_WEIGHT in labels(callback.message.last_markup)
        stored = await linked_store.language(CHAT_ID)
        assert stored is not None and stored.language == "uz" and stored.explicit

    async def test_unlinked_chat_gets_the_next_step_in_the_new_language(
        self, api, store, state: FSMContext
    ) -> None:
        callback = FakeCallback(data=f"{keyboards.LANGUAGE_PREFIX}uz")

        await start.language_chosen(callback, state, api, store, SETTINGS)

        assert api.language_writes == [], "сервера, которому принадлежал бы выбор, ещё нет"
        assert [text for text, _ in callback.message.answers] == [
            texts_uz.LANGUAGE_CHOSEN,
            texts_uz.START_NEED_CODE,
        ]

    async def test_server_failure_keeps_the_choice_and_retries(
        self, api, linked_store, state: FSMContext
    ) -> None:
        api.language_error = BotApiError("transport", "down", 0)
        await start.language_chosen(
            FakeCallback(data=f"{keyboards.LANGUAGE_PREFIX}uz"), state, api, linked_store, SETTINGS
        )
        stored = await linked_store.language(CHAT_ID)
        assert stored is not None and stored.pending and stored.language == "uz"

        # Связь вернулась: следующая сверка отправляет выбор, а не затирает его.
        api.language_error = None
        api.server_language = "ru"
        resolved = await language.resolve(
            api=api, store=linked_store, chat_id=CHAT_ID, telegram_code="ru"
        )
        assert resolved == "uz"
        assert api.language_writes == ["uz"]

    async def test_unknown_language_is_ignored(self, api, store, state: FSMContext) -> None:
        callback = FakeCallback(data=f"{keyboards.LANGUAGE_PREFIX}xx")

        await start.language_chosen(callback, state, api, store, SETTINGS)

        assert callback.message.answers == []

    async def test_unlinked_start_offers_the_languages(self, store, state: FSMContext) -> None:
        message = FakeMessage(text="/start")

        await start.start_without_code(message, state, store, SETTINGS)

        assert message.last == texts_ru.START_NEED_CODE
        assert "O‘zbekcha" in " ".join(labels(message.last_markup))

    async def test_unlinked_free_text_offers_the_languages(
        self, api, store, state: FSMContext
    ) -> None:
        message = FakeMessage(text="salom")

        await fallback.unknown(message, state, api, store, SETTINGS)

        assert message.last == texts_ru.NOT_LINKED
        assert "O‘zbekcha" in " ".join(labels(message.last_markup))


@pytest.mark.asyncio
class TestResolve:
    async def test_unlinked_chat_follows_telegram(self, api, store) -> None:
        assert (
            await language.resolve(api=api, store=store, chat_id=CHAT_ID, telegram_code="uz")
            == "uz"
        )
        assert (
            await language.resolve(api=api, store=store, chat_id=CHAT_ID, telegram_code="en")
            == "ru"
        )

    async def test_unset_server_language_takes_the_telegram_default(
        self, api, linked_store
    ) -> None:
        resolved = await language.resolve(
            api=api, store=linked_store, chat_id=CHAT_ID, telegram_code="uz"
        )

        assert resolved == "uz"
        assert api.language_writes == ["uz"], "умолчание сохраняется — для Mini App и рассылок"

    async def test_server_choice_beats_telegram(self, api, linked_store) -> None:
        api.server_language = "ru"

        resolved = await language.resolve(
            api=api, store=linked_store, chat_id=CHAT_ID, telegram_code="uz"
        )

        assert resolved == "ru"
        assert api.language_writes == []

    async def test_fresh_copy_spares_the_server(self, api, linked_store) -> None:
        await linked_store.set_language(
            CHAT_ID, StoredLanguage(language="uz", checked_at=time.time())
        )
        api.language_error = RuntimeError("сервер не должен был понадобиться")

        assert (
            await language.resolve(api=api, store=linked_store, chat_id=CHAT_ID, telegram_code="ru")
            == "uz"
        )

    async def test_stale_copy_follows_a_change_made_in_the_mini_app(
        self, api, linked_store
    ) -> None:
        stale = StoredLanguage(language="ru", checked_at=time.time() - 3600)
        await linked_store.set_language(CHAT_ID, stale)
        api.server_language = "uz"

        assert (
            await language.resolve(api=api, store=linked_store, chat_id=CHAT_ID, telegram_code="ru")
            == "uz"
        )

    async def test_server_failure_never_blocks_the_message(self, api, linked_store) -> None:
        api.language_error = BotApiError("transport", "down", 0)

        assert (
            await language.resolve(api=api, store=linked_store, chat_id=CHAT_ID, telegram_code="uz")
            == "uz"
        )


@pytest.mark.asyncio
class TestLinkingInUzbek:
    async def test_bot_sends_its_language_and_greets_in_the_servers(self, api, store) -> None:
        api.verified = replace(api.verified, language="uz")
        message = FakeMessage(text="/start ABCD2345")

        with i18n.use("uz"):
            await start._link(message, api=api, store=store, settings=SETTINGS, code="ABCD2345")

            assert api.activation_language == "uz"
            assert message.last.startswith("Tayyor, chat ulandi")

    async def test_choice_made_before_linking_wins_over_an_older_one(self, api, store) -> None:
        """Учётная запись заведена раньше по-русски, а здесь человек выбрал узбекский."""

        await store.set_language(CHAT_ID, StoredLanguage(language="uz", explicit=True))
        api.verified = replace(api.verified, language="ru")
        message = FakeMessage(text="/start ABCD2345")

        with i18n.use("uz"):
            await start._link(message, api=api, store=store, settings=SETTINGS, code="ABCD2345")

            assert api.language_writes == ["uz"]
            assert message.last.startswith("Tayyor")
