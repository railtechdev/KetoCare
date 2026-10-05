"""Привязка чата: `/start <код>` (раздел 7.1 ТЗ)."""

from __future__ import annotations

import uuid

from aiogram import Bot, F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InaccessibleMessage, Message, ReplyKeyboardMarkup

from .. import i18n, keyboards, language, texts
from ..api import BotApi, BotApiError, LinkVerified
from ..config import BotSettings
from ..deps import menu
from ..storage import Binding, BindingStore

router = Router(name="start")

# Код — восемь символов из алфавита без похожих знаков (см. репозиторий
# access_codes). Здесь проверяется только длина и состав: настоящую проверку
# делает API, а бот лишь не гоняет заведомый мусор.
CODE_LENGTH = 8


def compact_code(value: str) -> str:
    """Код без пробелов и дефисов: его диктуют и записывают группами «ABCD EFGH».

    Регистр и кириллические двойники («А» вместо «A») приводит API — одна
    реализация на все каналы.
    """

    return "".join(ch for ch in value if not ch.isspace() and ch != "-")


def looks_like_code(value: str) -> bool:
    candidate = compact_code(value)
    return len(candidate) == CODE_LENGTH and candidate.isalnum()


@router.message(CommandStart(deep_link=True))
async def start_with_code(
    message: Message,
    command: CommandObject,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    await state.clear()
    await _link(message, api=api, store=store, settings=settings, code=(command.args or ""))


@router.message(CommandStart())
async def start_without_code(
    message: Message, state: FSMContext, store: BindingStore, settings: BotSettings
) -> None:
    await state.clear()
    bindings = await store.all(message.chat.id)
    binding = await store.get(message.chat.id)
    if binding is None:
        # Языки — прямо под первым сообщением: умолчание из Telegram угадывает
        # не всегда (у узбекской семьи интерфейс бывает русским или английским),
        # и выбор обязан быть виден до того, как понадобится (ADR-0052).
        await message.answer(texts.START_NEED_CODE, reply_markup=keyboards.languages())
        return
    text = (
        texts.START_ALREADY_LINKED_SEVERAL.format(
            children=_names(bindings), active=binding.first_name
        )
        if len(bindings) >= 2
        else texts.START_ALREADY_LINKED.format(patient_name=binding.patient_name)
    )
    await message.answer(text, reply_markup=await menu(store, message.chat.id, settings))


@router.message(Command("help"))
async def help_command(message: Message, settings: BotSettings, store: BindingStore) -> None:
    """Единственное место, где написано, что бот умеет.

    И ответы на вопросы, которые обязательно возникнут: «как исправить
    ошибочную запись», «где напоминания», «как отключить потерянный телефон» —
    в приложении или у тех, кто выдаёт коды, а не в кабинете, которого у
    взрослого из Telegram обычно нет. Строка про приложение — только когда
    кнопка приложения есть.
    """

    if message.chat.type != "private":
        return
    await message.answer(
        texts.HELP.format(app_line=texts.HELP_APP_LINE if settings.has_miniapp else ""),
        reply_markup=await menu(store, message.chat.id, settings),
    )


async def handle_bare_code(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Код, присланный сообщением, а не по ссылке.

    Deep-link открывается с телефона одним нажатием, но родитель, читающий
    кабинет с компьютера, перепишет код руками. Отказывать ему из-за формы ввода
    незачем.

    Начатый сценарий закрывается, как и при `/start <код>`: код другого ребёнка
    делает выбранным его, и запись, начатая про прежнего, продолжаться не
    должна (ADR-0048, ревью). Шаги сценария и без этого пишут ребёнку, про
    которого начаты (`deps.scenario_binding`), — это вторая линия.
    """

    await state.clear()
    await _link(message, api=api, store=store, settings=settings, code=message.text or "")


async def _link(
    message: Message, *, api: BotApi, store: BindingStore, settings: BotSettings, code: str
) -> None:
    if message.chat.type != "private":
        # Привязка — к семье, а не к комнате. В группе `chat.id` принадлежит
        # группе: дневник ребёнка вёлся бы от её имени, уведомления о смене
        # назначения приходили бы всем её участникам, а Mini App искал бы
        # привязку по идентификатору человека и не находил её вовсе. Всё это
        # обнаружилось бы уже на клинических данных.
        await message.answer(texts.LINK_ONLY_PRIVATE)
        return

    if message.from_user is None:
        # Сообщение без автора приходит от канала. Привязывать некого: учётная
        # запись родителя заводится по идентификатору человека.
        await message.answer(texts.LINK_ONLY_PRIVATE)
        return

    verified = None
    try:
        verified = await api.activate_access_code(
            code=compact_code(code),
            chat_id=message.chat.id,
            telegram_user_id=message.from_user.id,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
            # Язык, на котором бот уже говорит с человеком (ADR-0052).
            language=i18n.current(),
        )
    except BotApiError as exc:
        if exc.status == 409:
            await message.answer(
                _conflict_text(exc),
                reply_markup=await _menu_if_linked(exc, store, message, settings),
            )
            return
        if exc.status == 404:
            await message.answer(texts.LINK_CODE_INVALID)
            return
        await message.answer(texts.API_UNAVAILABLE)
        return

    # Привязка ребёнка добавляется к уже имеющимся и становится выбранной: код
    # только что прислан ради него (ADR-0048).
    binding = Binding(
        link_id=verified.link_id,
        secret=verified.secret,
        patient_id=verified.patient_id,
        patient_name=verified.patient_name,
        patient_first_name=verified.patient_first_name,
    )
    await store.put(message.chat.id, binding)
    # Теперь сервер знает человека: приветствие — на его языке (ADR-0052).
    await language.after_link(
        api=api,
        store=store,
        chat_id=message.chat.id,
        binding=binding,
        server_language=verified.language,
    )
    await language.apply_chat_ui(_bot_of(message), message.chat.id, settings)
    await message.answer(
        welcome(verified, settings, children=await store.all(message.chat.id)),
        reply_markup=await menu(store, message.chat.id, settings),
    )


def welcome(
    verified: LinkVerified, settings: BotSettings, *, children: list[Binding] | None = None
) -> str:
    """Приветствие после привязки: что у семьи теперь есть и где.

    Строка про приложение — только когда кнопка приложения есть, как в /help.
    Строка про кабинет — всегда, но разная: семье от врача кабинет ещё надо
    включить, семья с кабинетом получает просто адрес.

    Второй ребёнок в том же чате (ADR-0048) — другое приветствие: о приложении
    и кабинете семья уже знает, а знать ей нужно одно — как переключаться.
    """

    if children is not None and len(children) >= 2:
        return texts.LINK_SUCCESS_SEVERAL.format(
            patient_name=verified.patient_name,
            children=_names(children),
            switch=texts.BTN_CHILD_PREFIX,
        )

    lines = [texts.LINK_SUCCESS.format(patient_name=verified.patient_name)]
    if settings.has_miniapp:
        lines.append(texts.LINK_SUCCESS_APP_LINE)
    cabinet = (
        texts.LINK_SUCCESS_CABINET_ON
        if verified.has_web_credentials
        else texts.LINK_SUCCESS_CABINET_OFF
    )
    lines.append(cabinet.format(web_url=verified.web_url))
    return "".join(lines)


def _conflict_text(exc: BotApiError) -> str:
    """Отказ по существу: у каждой причины свой следующий шаг (ADR-0043).

    Прежде любой 409 звучал как «чат привязан к другому ребёнку — отвяжите в
    кабинете», и бабушка, у которой кабинета нет, оставалась перед стеной.
    Причины без своего текста — «у выдавшего нет доступа», «Telegram
    сотрудника» — API называет сам, и его сообщение уже русское и конкретное.
    """

    # «Чат занят другим ребёнком» больше не бывает: код другого ребёнка его
    # добавляет (ADR-0048).
    if exc.details.get("reason") == "already_here":
        return texts.LINK_ALREADY_HERE
    return exc.message or texts.API_UNAVAILABLE


async def _menu_if_linked(
    exc: BotApiError, store: BindingStore, message: Message, settings: BotSettings
) -> ReplyKeyboardMarkup | None:
    # «Уже здесь» — значит, чат рабочий: сразу показать, что можно делать.
    if exc.details.get("reason") == "already_here":
        return await menu(store, message.chat.id, settings)
    return None


def _names(bindings: list[Binding]) -> str:
    return ", ".join(binding.first_name for binding in bindings)


def _bot_of(message: Message) -> Bot | None:
    """Бот, от имени которого пришло сообщение; в тестах его нет."""

    bot = getattr(message, "bot", None)
    return bot if isinstance(bot, Bot) else None


# --- Язык (ADR-0052) ----------------------------------------------------
#
# Кнопка «🌐 Til / Язык» есть в каждом меню, команда /language — в синем
# меню, языки — под первым сообщением непривязанного чата. Выбор закрывает
# начатый сценарий так же, как любая кнопка меню: клавиатуры сценария были на
# прежнем языке.


@router.message(Command("language"))
@router.message(F.text.in_(i18n.variants("BTN_LANGUAGE")))
async def language_menu(message: Message, state: FSMContext) -> None:
    if message.chat.type != "private":
        return
    await state.clear()
    await message.answer(texts.LANGUAGE_ASK, reply_markup=keyboards.languages())


@router.callback_query(F.data.startswith(keyboards.LANGUAGE_PREFIX))
async def language_chosen(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    await callback.answer()
    message = callback.message
    if message is None or isinstance(message, InaccessibleMessage):
        return
    chosen = i18n.known((callback.data or "").removeprefix(keyboards.LANGUAGE_PREFIX))
    if chosen is None:
        return
    await state.clear()
    await language.choose(api=api, store=store, chat_id=message.chat.id, language=chosen)
    # Подтверждение — уже на выбранном языке: так человек и видит, что выбор
    # сработал, даже не прочитав, что там написано.
    i18n.switch(chosen)
    await language.apply_chat_ui(_bot_of(message), message.chat.id, settings)
    if await store.get(message.chat.id) is None:
        # Непривязанному — следующий шаг на новом языке: прислать код.
        await message.answer(texts.LANGUAGE_CHOSEN)
        await message.answer(texts.START_NEED_CODE)
        return
    await message.answer(
        texts.LANGUAGE_CHOSEN, reply_markup=await menu(store, message.chat.id, settings)
    )


# --- Выбор ребёнка (ADR-0048) -------------------------------------------
#
# Обработчики живут в этом роутере, а не в сценариях: он подключён первым, и
# кнопка выбора побеждает незаконченный ввод так же, как кнопки сценариев.
# Выбор закрывает начатый сценарий: запись, начатая про одного ребёнка, не
# должна уйти другому — шаги сценариев привязаны к состоянию, и после
# `state.clear()` ни один из них не сработает.


@router.message(F.text.startswith(i18n.variants("BTN_CHILD_PREFIX")))
async def child_menu(
    message: Message, state: FSMContext, store: BindingStore, settings: BotSettings
) -> None:
    if message.chat.type != "private":
        return
    await state.clear()
    bindings = await store.all(message.chat.id)
    active = await store.get(message.chat.id)
    if active is None:
        await message.answer(texts.NOT_LINKED)
        return
    if len(bindings) < 2:
        await message.answer(
            texts.CHILD_ONLY_ONE.format(name=active.first_name),
            reply_markup=await menu(store, message.chat.id, settings),
        )
        return
    await message.answer(
        texts.CHILD_ASK.format(active=active.first_name),
        reply_markup=keyboards.children(
            [(str(b.patient_id), b.first_name) for b in bindings], active=str(active.patient_id)
        ),
    )


@router.callback_query(F.data.startswith(keyboards.CHILD_PREFIX))
async def child_chosen(
    callback: CallbackQuery, state: FSMContext, store: BindingStore, settings: BotSettings
) -> None:
    await callback.answer()
    message = callback.message
    # Исключением «недоступного», а не проверкой на `Message` — так же, как
    # `scenarios._answerable`: иначе поддельное сообщение в тестах уводило бы
    # обработчик в ранний возврат.
    if message is None or isinstance(message, InaccessibleMessage):
        return
    await state.clear()
    try:
        patient_id = uuid.UUID((callback.data or "").removeprefix(keyboards.CHILD_PREFIX))
    except ValueError:
        return
    chosen = await store.select(message.chat.id, patient_id)
    if chosen is None:
        await message.answer(
            texts.CHILD_GONE, reply_markup=await menu(store, message.chat.id, settings)
        )
        return
    await message.answer(
        texts.CHILD_CHOSEN.format(name=chosen.first_name),
        reply_markup=await menu(store, message.chat.id, settings),
    )
