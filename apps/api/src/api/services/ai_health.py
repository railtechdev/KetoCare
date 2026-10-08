"""Состояние ИИ-подсистемы для монитора доступности (`GET /health/ai`).

С 08.09.2026 на тестовом стенде каждое обращение к модели отвечало
`400 invalid_request_error` («API key is not scoped to a workspace»), и месяц
этого никто не видел: помощник, черновики карточек и сводка врача честно
показывали свои шаблоны «сейчас недоступно», а монитор проверял только, что
стенд отвечает. Причина лежала в `ai_jobs.error` всё это время.

Проверка пассивная — по журналу `ai_jobs`, без собственного обращения к модели.
Пробный вызов стоил бы денег раз в пятнадцать минут и проверял бы не то: ключ
может работать, а подпись модели в `AI_MODEL_SMART` — нет, и наоборот.
Журнал же пишет КАЖДЫЙ настоящий вызов, включая неудачный.

Что наружу НЕ уходит ни при каком исходе: текст ошибки, нагрузка, ответ модели,
значения ключа и имён моделей. Текст ошибки сводится к классу —
`BadRequestError 400 invalid_request_error` — словами, вырезанными из него
регулярными выражениями по узкому алфавиту. Сообщение сервера Anthropic в
класс не попадает: в нём бывает что угодно, вплоть до куска запроса.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings
from core.models.enums import AiJobStatus
from core.repositories import ai_jobs as ai_jobs_repo

from ..schemas_health import AiConfigured, AiFailureClass, AiHealth, AiJobCounts

#: Окно наблюдения. Монитор судит по суткам: за час ночью вызовов может не
#: быть вовсе, и «ни одного успеха» ничего бы не значило.
WINDOW = timedelta(hours=24)

#: С какого возраста «выполняется» значит «застряло». Вызов модели ограничен
#: таймаутом в 60 секунд; пятнадцать минут — с большим запасом на очередь.
STUCK_AFTER = timedelta(minutes=15)

#: Сколько классов неудач показывать: монитору хватает частых.
TOP_CLASSES = 10

#: Предел длины класса. Класс собирается из коротких слов, и длиннее он
#: становится, только если разбор пошёл не так.
CLASS_MAX_CHARS = 80

_EXCEPTION_NAME = re.compile(r"^([A-Z][A-Za-z0-9_]{0,63}):")
_STATUS_CODE = re.compile(r"Error code: (\d{3})\b")
_ERROR_TYPE = re.compile(r"""['"]type['"]\s*:\s*['"]([a-z_]{1,40}_error)['"]""")

#: Типы ошибок API Anthropic. Найденное вне списка не показывается: регулярное
#: выражение ищет по всему тексту, и «тип» мог бы оказаться словом из сообщения.
_KNOWN_ERROR_TYPES = frozenset(
    {
        "invalid_request_error",
        "authentication_error",
        "billing_error",
        "permission_error",
        "not_found_error",
        "rate_limit_error",
        "api_error",
        "timeout_error",
        "overloaded_error",
    }
)
_STOP_REASON = re.compile(r"stop_reason=([a-z_]{1,32})\b")
_SAFE = re.compile(r"[^A-Za-z0-9_ =]")


def error_class(error: str | None) -> str:
    """Класс неудачи по тексту `ai_jobs.error` — без единого слова сообщения.

    Наружу идут только имя исключения, код HTTP и тип ошибки Anthropic (они из
    закрытых алфавитов), а для двух наших собственных записей — их условные
    имена. Всё остальное отбрасывается, даже если в нём ничего опасного нет:
    проверить «нет ли тут ключа» надёжнее, не пропуская текст вовсе.
    """

    text = error or ""
    parts: list[str] = []
    name = _EXCEPTION_NAME.match(text)
    if name:
        parts.append(name.group(1))
        status = _STATUS_CODE.search(text)
        if status:
            parts.append(status.group(1))
        kind = next((t for t in _ERROR_TYPE.findall(text) if t in _KNOWN_ERROR_TYPES), None)
        if kind:
            parts.append(kind)
    elif stop := _STOP_REASON.search(text):
        # «Модель не вернула текст: stop_reason=refusal» (`worker.ai.client`).
        parts += ["EmptyResponse", f"stop_reason={stop.group(1)}"]
    elif "процесс воркера прервался" in text:
        # Запись уборщика застрявших вызовов (`worker.maintenance`).
        parts.append("WorkerInterrupted")
    else:
        parts.append("Unknown")
    return _SAFE.sub("", " ".join(parts))[:CLASS_MAX_CHARS]


def _day_start(tz: str, now: datetime) -> datetime:
    """Начало местных суток в UTC — как у дневного бюджета воркера."""

    zone = ZoneInfo(tz)
    local_midnight = datetime.combine(now.astimezone(zone).date(), time.min, tzinfo=zone)
    return local_midnight.astimezone(UTC)


async def ai_health(session: AsyncSession, settings: Settings) -> AiHealth:
    now = datetime.now(UTC)
    since = now - WINDOW

    counts = await ai_jobs_repo.status_counts_since(
        session, since=since, stuck_before=now - STUCK_AFTER
    )
    errors = await ai_jobs_repo.failure_errors_since(session, since=since)
    classes = Counter(error_class(error) for error in errors)
    last_error = await ai_jobs_repo.last_failure_error(session)
    spent = await ai_jobs_repo.cost_since(session, since=_day_start(settings.tz, now))

    return AiHealth(
        window_hours=int(WINDOW.total_seconds() // 3600),
        checked_at=now,
        jobs=AiJobCounts(
            succeeded=counts.get(AiJobStatus.DONE.value, 0),
            failed=counts.get(AiJobStatus.FAILED.value, 0),
            running=counts.get(AiJobStatus.RUNNING.value, 0),
            stuck=counts.get("stuck", 0),
        ),
        last_success_at=await ai_jobs_repo.last_finished_at(session, status=AiJobStatus.DONE),
        last_failure_at=await ai_jobs_repo.last_finished_at(session, status=AiJobStatus.FAILED),
        last_failure_class=error_class(last_error) if last_error is not None else None,
        failure_classes=[
            AiFailureClass(error_class=name, count=count)
            for name, count in classes.most_common(TOP_CLASSES)
        ],
        daily_budget_exhausted=spent >= Decimal(str(settings.ai_daily_budget_usd)),
        configured=AiConfigured(
            api_key=bool(settings.anthropic_api_key),
            model_fast=bool(settings.ai_model_fast),
            model_smart=bool(settings.ai_model_smart),
        ),
    )
