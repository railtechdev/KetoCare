"""Привязка чата: `/start <код>` (раздел 7.1 ТЗ)."""

from __future__ import annotations

from aiogram import Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from .. import keyboards, texts
from ..api import BotApi, BotApiError, LinkVerified
from ..config import BotSettings
from ..storage import Binding, BindingStore

router = Router(name="start")

# Код — восемь символов из алфавита без похожих знаков (см. репозиторий
# access_codes). Здесь проверяется только длина и состав: настоящую проверку
# делает API, а бот лишь не гоняет заведомый мусор.
CODE_LENGTH = 8


def looks_like_code(value: str) -> bool:
    candidate = value.strip()
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
    binding = await store.get(message.chat.id)
    if binding is not None:
        await message.answer(
            texts.START_ALREADY_LINKED.format(patient_name=binding.patient_name),
            reply_markup=keyboards.main_menu(settings),
        )
        return
    await message.answer(texts.START_NEED_CODE)


@router.message(Command("help"))
async def help_command(message: Message, settings: BotSettings) -> None:
    """Единственное место, где написано, что бот умеет.

    И ответы на два вопроса, которые обязательно возникнут: «как исправить
    ошибочную запись» и «как отвязать чат» — оба решаются в кабинете, и не
    сказать об этом значит оставить родителя наедине с ошибкой в клинической
    записи. Строка про приложение — только когда кнопка приложения есть.
    """

    if message.chat.type != "private":
        return
    await message.answer(
        texts.HELP.format(app_line=texts.HELP_APP_LINE if settings.has_miniapp else ""),
        reply_markup=keyboards.main_menu(settings),
    )


async def handle_bare_code(
    message: Message, api: BotApi, store: BindingStore, settings: BotSettings
) -> None:
    """Код, присланный сообщением, а не по ссылке.

    Deep-link открывается с телефона одним нажатием, но родитель, читающий
    кабинет с компьютера, перепишет код руками. Отказывать ему из-за формы ввода
    незачем.
    """

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
            code=code.strip(),
            chat_id=message.chat.id,
            telegram_user_id=message.from_user.id,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
        )
    except BotApiError as exc:
        if exc.status == 409:
            await message.answer(texts.LINK_CHAT_BUSY)
            return
        if exc.status == 404:
            await message.answer(texts.LINK_CODE_INVALID)
            return
        await message.answer(texts.API_UNAVAILABLE)
        return

    await store.put(
        message.chat.id,
        Binding(
            link_id=verified.link_id,
            secret=verified.secret,
            patient_id=verified.patient_id,
            patient_name=verified.patient_name,
        ),
    )
    await message.answer(
        welcome(verified, settings),
        reply_markup=keyboards.main_menu(settings),
    )


def welcome(verified: LinkVerified, settings: BotSettings) -> str:
    """Приветствие после привязки: что у семьи теперь есть и где.

    Строка про приложение — только когда кнопка приложения есть, как в /help.
    Строка про кабинет — всегда, но разная: семье от врача кабинет ещё надо
    включить, семья с кабинетом получает просто адрес.
    """

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
