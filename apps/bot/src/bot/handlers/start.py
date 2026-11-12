"""Привязка чата: `/start <код>` (раздел 7.1 ТЗ)."""

from __future__ import annotations

import uuid

from aiogram import Bot, F, Router
from aiogram.exceptions import TelegramBadRequest
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


#: Знаки, из которых может состоять набранный код: латиница и цифры — и
#: кириллические двойники латинских букв, которые API приводит к латинице
#: (`access_codes.normalize_code`): код переписывают на русской раскладке.
_CODE_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789АВЕКМНРСТУХавекмнрстух"
)


def looks_like_code(value: str) -> bool:
    """Похоже ли сообщение на код доступа.

    Прежде годились любые восемь букв и цифр: «лекарств» и «спасибо!» без
    знака считались кодом, отвечали «код не подошёл» и сбрасывали начатую
    запись (аудит продукта 12.11.2026). Теперь — только знаки алфавита кода
    и их кириллические двойники; слово с «л», «и» или «б» кодом не бывает.
    """

    candidate = compact_code(value)
    return len(candidate) == CODE_LENGTH and all(ch in _CODE_CHARS for ch in candidate)


@router.message(CommandStart(deep_link=True))
async def start_with_code(
    message: Message,
    command: CommandObject,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    if await _group(message, store):
        return
    await state.clear()
    await _link(message, api=api, store=store, settings=settings, code=(command.args or ""))


@router.message(CommandStart())
async def start_without_code(
    message: Message, state: FSMContext, store: BindingStore, settings: BotSettings
) -> None:
    if await _group(message, store):
        return
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
        else texts.START_ALREADY_LINKED.format(patient_name=binding.first_name)
    )
    await message.answer(text, reply_markup=await menu(store, message.chat.id, settings))


async def _group(message: Message, store: BindingStore) -> bool:
    """`/start` в группе: объяснить один раз, что бот работает только в личке.

    Привязка — к семье, а не к комнате (см. `_link`). Прежде `/start` в группе
    просил там код, а каждый следующий — снова; теперь группа слышит это
    один раз, дальше бот в ней молчит.
    """

    if message.chat.type == "private":
        return False
    if await store.first_time_in_group(message.chat.id):
        await message.answer(texts.GROUP_ONLY_PRIVATE)
    return True


@router.message(Command("help"))
@router.message(F.text.in_(i18n.variants("BTN_HELP")))
async def help_command(
    message: Message, state: FSMContext, settings: BotSettings, store: BindingStore
) -> None:
    """Короткая справка с кнопками (ADR-0076).

    Прежде справка была стеной текста за командой /help, которую находят,
    только набрав «/». Теперь — кнопка «❓ Помощь · Yordam» в меню, ответ в
    три строки и кнопки: язык, приложение, как исправить запись, остальные
    вопросы. Нажатие кнопки меню закрывает начатую запись, как любая кнопка
    меню.
    """

    if message.chat.type != "private":
        return
    await state.clear()
    await message.answer(_help_short(settings), reply_markup=keyboards.help_menu(settings))


def _help_short(settings: BotSettings) -> str:
    return texts.HELP_SHORT.format(
        app_line=texts.HELP_SHORT_APP_LINE if settings.has_miniapp else ""
    )


@router.callback_query(F.data.startswith("help:"))
async def help_button(callback: CallbackQuery, settings: BotSettings) -> None:
    await callback.answer()
    message = callback.message
    if message is None or isinstance(message, InaccessibleMessage):
        return
    data = callback.data
    if data == keyboards.HELP_LANGUAGE_DATA:
        text, markup = texts.LANGUAGE_ASK, keyboards.languages()
    elif data == keyboards.HELP_FIX_DATA:
        text, markup = texts.HELP_FIX, keyboards.help_back()
    elif data == keyboards.HELP_MORE_DATA:
        text = texts.HELP.format(app_line=texts.HELP_APP_LINE if settings.has_miniapp else "")
        markup = keyboards.help_back()
    else:
        text, markup = _help_short(settings), keyboards.help_menu(settings)
    try:
        await message.edit_text(text, reply_markup=markup)
    except TelegramBadRequest:
        return


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
    Кабинета здесь нет (аудит продукта 12.11.2026): первое сообщение говорит,
    где записывать и что остальное в приложении, а кабинет описан в /help.

    Второй ребёнок в том же чате (ADR-0048) — другое приветствие: о приложении
    и кабинете семья уже знает, а знать ей нужно одно — как переключаться.
    """

    if children is not None and len(children) >= 2:
        return texts.LINK_SUCCESS_SEVERAL.format(
            patient_name=_first_name(verified),
            children=_names(children),
            switch=texts.BTN_CHILD_PREFIX,
        )

    lines = [texts.LINK_SUCCESS.format(patient_name=_first_name(verified))]
    if settings.has_miniapp:
        lines.append(texts.LINK_SUCCESS_APP_LINE)
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


def _first_name(verified: LinkVerified) -> str:
    """Имя ребёнка без фамилии: фамилию в переписку не отдаём (ADR-0048, п. 5)."""

    if verified.patient_first_name:
        return verified.patient_first_name
    parts = verified.patient_name.split()
    return parts[0] if parts else verified.patient_name


def _names(bindings: list[Binding]) -> str:
    return ", ".join(binding.first_name for binding in bindings)


def _bot_of(message: Message) -> Bot | None:
    """Бот, от имени которого пришло сообщение; в тестах его нет."""

    bot = getattr(message, "bot", None)
    return bot if isinstance(bot, Bot) else None


# --- Язык (ADR-0052) ----------------------------------------------------
#
# Язык — первая кнопка справки «❓ Помощь · Yordam» (ADR-0076), команда
# /language — в синем меню, языки — под первым сообщением непривязанного чата.
# Прежняя кнопка меню «🌐 Til / Язык» остаётся понятной боту: клавиатура,
# присланная до выката, стоит у семьи, пока бот не пришлёт новую. Выбор закрывает
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
