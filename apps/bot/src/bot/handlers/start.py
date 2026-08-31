"""Привязка чата: `/start <код>` (раздел 7.1 ТЗ)."""

from __future__ import annotations

from aiogram import Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from .. import keyboards, texts
from ..api import BotApi, BotApiError
from ..config import BotSettings
from ..storage import Binding, BindingStore

router = Router(name="start")

# Код — восемь символов из алфавита без похожих знаков (см. репозиторий
# link_codes). Здесь проверяется только длина и состав: настоящую проверку
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

    verified = None
    try:
        verified = await api.verify_link_code(code=code.strip(), chat_id=message.chat.id)
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
        texts.LINK_SUCCESS.format(patient_name=verified.patient_name),
        reply_markup=keyboards.main_menu(settings),
    )
