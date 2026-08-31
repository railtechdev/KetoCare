"""Напоминания семье (раздел 7.4 ТЗ).

Задача идёт каждые пять минут и решает три вопроса: кому сейчас время
напомнить, нужно ли это ещё (запись могла уже появиться) и не отправляли ли мы
это сегодня.

Почему воркер, а не бот: у бота нет ни расписания, ни доступа к базе — он
ходит только в API по сервисному токену (раздел 7 ТЗ). Очередь «воркер → бот»
добавила бы третий канал доставки со своими отказами там, где хватает прямого
вызова Telegram.

Тексты — здесь, рядом с задачей, и согласуются с медицинской командой: раздел
7.4 требует мягкости, а не «вы пропустили замер».
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import structlog

from core.config import Settings
from core.db import get_sessionmaker
from core.models import KetoneLog, MedicationLog, WeightLog
from core.repositories import diary as diary_repo
from core.repositories import reminders as reminders_repo

from .telegram import TelegramSendError, send_message

logger = structlog.get_logger(__name__)

#: Ширина окна попадания.
#:
#: Задача идёт раз в пять минут, и точного совпадения «сейчас == 07:30» не
#: бывает почти никогда. Окно чуть шире шага: при задержке очереди напоминание
#: не должно пропадать до завтра.
WINDOW = timedelta(minutes=6)

#: Тексты. Мягкие и без обвинения: семья и так знает, что пропустила, а
#: напоминание, которое читается как упрёк, выключают в первый же день.
TEXTS = {
    "ketones": "Напоминание: пора измерить кетоны 🩸",
    "weight": "Напоминание: пора взвесить ребёнка ⚖️",
    "medications": "Напоминание: приём препаратов по схеме 💊",
    "no_records": (
        "За сегодня в дневнике нет записей. Если день прошёл спокойно — так и "
        "отметьте, врачу это тоже важно."
    ),
}

#: Какой моделью дневника проверяется, что напоминать уже не о чем.
_LOG_MODELS: dict[str, Any] = {
    "ketones": KetoneLog,
    "weight": WeightLog,
    "medications": MedicationLog,
}


async def reminders_cron(ctx: dict[str, Any]) -> dict[str, int]:
    """Разослать напоминания, которым настало время.

    Возвращает счётчики — по ним из журнала ARQ видно, работает задача или
    молча ничего не находит.
    """

    settings = Settings()  # type: ignore[call-arg]
    if not settings.bot_token:
        # Без токена отправлять нечем. Это не сбой: бот может быть не настроен
        # на этой установке, и падать каждые пять минут задача не должна.
        return {"sent": 0, "skipped": 0}

    zone = ZoneInfo(settings.tz)
    now_local = datetime.now(zone)
    sessionmaker = get_sessionmaker()

    sent = 0
    skipped = 0

    async with sessionmaker() as session, httpx.AsyncClient(timeout=10.0) as client:
        for reminder, link in await reminders_repo.list_active(session):
            for kind, at in _due_kinds(reminder, now_local):
                if at is None:
                    continue

                if await _already_recorded(
                    session, kind=kind, patient_id=reminder.patient_id, day=now_local.date()
                ):
                    skipped += 1
                    continue

                # Право занимается ДО отправки: лучше пропустить напоминание
                # при сбое сети, чем прислать его дважды.
                claimed = await reminders_repo.claim_delivery(
                    session,
                    patient_id=reminder.patient_id,
                    kind=kind,
                    sent_on=now_local.date(),
                    chat_id=link.chat_id,
                )
                if not claimed:
                    skipped += 1
                    continue

                try:
                    await send_message(
                        client,
                        token=settings.bot_token,
                        chat_id=link.chat_id,
                        text=TEXTS[kind],
                    )
                except TelegramSendError as exc:
                    # Чат мог быть заблокирован или удалён. Это не повод ронять
                    # рассылку остальным семьям.
                    logger.warning(
                        "reminder_not_delivered",
                        patient_id=str(reminder.patient_id),
                        kind=kind,
                        reason=str(exc),
                    )
                    continue

                sent += 1

        await session.commit()

    return {"sent": sent, "skipped": skipped}


def _due_kinds(reminder: Any, now_local: datetime) -> list[tuple[str, time | None]]:
    """Виды напоминаний, чьё время наступило в текущем окне."""

    schedule = [
        ("ketones", reminder.ketones_at),
        ("weight", reminder.weight_at),
        ("medications", reminder.medications_at),
        ("no_records", reminder.no_records_at),
    ]
    return [(kind, at) for kind, at in schedule if at is not None and _is_due(at, now_local)]


def _is_due(at: time, now_local: datetime) -> bool:
    """Наступило ли время `at` в текущем окне.

    Сравниваются моменты одного дня: «23:58» при окне в шесть минут не должно
    срабатывать в 00:02 следующих суток — это уже другой день, и запись за него
    считается отдельно.
    """

    target = now_local.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    delta = now_local - target
    return timedelta(0) <= delta < WINDOW


async def _already_recorded(session: Any, *, kind: str, patient_id: Any, day: date) -> bool:
    """Запись за сегодня уже есть — напоминать не о чем.

    Для «нет записей» проверяются все три вида сразу: смысл этого напоминания в
    том, что день пуст, а не в том, что пропущен конкретный замер.
    """

    start = datetime.combine(day, time.min, tzinfo=UTC) - timedelta(days=1)
    end = datetime.combine(day, time.max, tzinfo=UTC) + timedelta(days=1)

    models = list(_LOG_MODELS.values()) if kind == "no_records" else [_LOG_MODELS[kind]]
    for model in models:
        _, total = await diary_repo.list_for_patient(
            session,
            model,
            patient_id=patient_id,
            period_from=start,
            period_to=end,
            limit=1,
        )
        if total:
            return True
    return False
