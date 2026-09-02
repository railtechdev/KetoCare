"""Единственная дверь к Claude API (раздел 10.2 ТЗ, правило 6 `CLAUDE.md`).

Здесь сходится всё, что должно случаться при КАЖДОМ обращении к модели и о чём
нельзя вспоминать в каждой задаче отдельно:

- псевдонимизация нагрузки (`pseudonymize`) — обойти её, не переписав этот
  модуль, нельзя;
- предохранители: суточный предел пользователя и дневной бюджет проекта;
- строка в `ai_jobs` — до вызова, чтобы след остался даже если процесс умрёт,
  и с токенами и стоимостью после, включая неудачу;
- имя модели из окружения (`AI_MODEL_FAST` / `AI_MODEL_SMART`), а не из кода;
- ретраи и таймаут.

Чего здесь нет намеренно: промптов и разбора ответа. Промпты живут файлами в
`prompts/` и меняются отдельным PR (раздел 10.4 ТЗ), разбор — дело задачи,
которая знает, чего просила. Клиент отвечает за «как обратиться», а не «о чём».
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time
from decimal import Decimal
from typing import Any, Protocol, cast
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import async_sessionmaker

from core.config import Settings
from core.models.enums import AiJobKind
from core.repositories import ai_jobs as jobs_repo

from .pricing import UnknownModelPrice, assert_priced, estimate_cost, reserve_cost
from .pseudonymize import pseudonymize, scrub_free_text

#: Задачи, к которым применяется суточный предел ПОЛЬЗОВАТЕЛЯ.
#:
#: Раздел 10.2 ТЗ говорит о пределе «N запросов ассистента в сутки» — именно
#: ассистента: разбор еды родитель делает столько раз, сколько раз кормит
#: ребёнка, и упереться в предел посреди дня означало бы остаться без функции,
#: ради которой бот и нужен. Разбор и сводку ограничивает дневной бюджет
#: проекта — он общий и не зависит от того, кто именно потратил.
USER_LIMITED_KINDS: tuple[AiJobKind, ...] = (AiJobKind.ASSISTANT,)

#: Задачи, которым положена быстрая модель (раздел 10.2 ТЗ).
FAST_KINDS: frozenset[AiJobKind] = frozenset({AiJobKind.PARSE_MEAL, AiJobKind.PARSE_EVENT})

#: Потолок ответа по умолчанию. Сводка врачу длиннее — она передаёт своё
#: значение; разбор еды короче любого потолка.
DEFAULT_MAX_TOKENS = 4096

#: Сколько ждём ответа. Раздел 10.1 ТЗ даёт разбору 15 секунд, потому что ручка
#: `POST /ai/parse` ждёт его синхронно; остальным задачам спешить некуда.
DEFAULT_TIMEOUT_S = 60.0
#: Ретраи — три, экспоненциально (раздел 10.2 ТЗ). Их делает сам SDK: свой цикл
#: поверх чужого дал бы девять попыток вместо трёх.
MAX_RETRIES = 3


class AiError(RuntimeError):
    """Общий предок отказов ИИ-модуля: задачам нужно отличать их от прочего."""


class AiLimitExceeded(AiError):
    """Предел пользователя или бюджет проекта исчерпан.

    Отдельный тип, потому что ответ пользователю другой: это не «сломалось», а
    «на сегодня хватит», и в API он превращается в `rate_limited` с понятным
    русским текстом (раздел 10.2 ТЗ).
    """


class AiUnavailable(AiError):
    """Модель не ответила.

    Раздел 10.2 ТЗ требует мягкой деградации: бот предлагает выбрать из меню,
    ассистент пишет «временно недоступен», остальная система не замечает ничего.
    Поэтому наружу идёт один понятный тип, а не то, что бросил SDK.
    """


class NotConfigured(AiError):
    """Ключа или имени модели в окружении нет — обращаться некуда."""


@dataclass(frozen=True)
class AiAnswer:
    """Ответ модели вместе со следом, который он оставил в журнале."""

    job_id: uuid.UUID
    text: str
    model: str
    tokens_in: int | None
    tokens_out: int | None
    cost_usd: Decimal | None


class MessagesApi(Protocol):
    """То, чем клиент пользуется у SDK, — ровно один метод.

    Протокол, а не импорт типа: тестам нужно подставить свою реализацию, не
    поднимая настоящий SDK и не выходя в сеть.
    """

    async def create(self, **kwargs: Any) -> Any: ...


class AnthropicLike(Protocol):
    @property
    def messages(self) -> MessagesApi: ...


class AiClient:
    """Обращение к модели с журналом, предохранителями и псевдонимизацией."""

    def __init__(
        self,
        *,
        sessionmaker: async_sessionmaker[Any],
        anthropic: AnthropicLike,
        settings: Settings,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._anthropic = anthropic
        self._settings = settings

    def model_for(self, kind: AiJobKind) -> str:
        """Имя модели из окружения. Пустое значение — отказ, а не подстановка.

        Подставить сюда имя по умолчанию значит зашить его в код: правило 6
        `CLAUDE.md` запрещает именно это, а молчаливая подстановка ещё и уводит
        расходы на модель, которую никто не выбирал.
        """

        variable = "AI_MODEL_FAST" if kind in FAST_KINDS else "AI_MODEL_SMART"
        model = (
            self._settings.ai_model_fast if kind in FAST_KINDS else self._settings.ai_model_smart
        )
        if not model:
            raise NotConfigured(f"Не задана переменная {variable} — обращаться не к какой модели.")

        # Модель без цены — это выключенный дневной бюджет: стоимость её вызовов
        # неизвестна, сумма за день считается нулём, и предохранитель не
        # срабатывает никогда. Поэтому отказ, а не молчаливое «посчитаем потом».
        try:
            assert_priced(model, variable=variable)
        except UnknownModelPrice as error:
            raise NotConfigured(str(error)) from error

        return model

    async def ask(
        self,
        *,
        kind: AiJobKind,
        requested_by: uuid.UUID,
        patient_id: uuid.UUID | None,
        system: str,
        payload: dict[str, Any],
        user_text: str | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> AiAnswer:
        """Спросить модель и записать вызов в журнал.

        `payload` — структурированные данные о ребёнке; они проходят через
        `pseudonymize` здесь, а не у вызывающего. `user_text` — то, что человек
        набрал сам: его чистить нечем и не нужно, он и так о себе.
        """

        if not self._settings.anthropic_api_key:
            raise NotConfigured("Не задан ANTHROPIC_API_KEY — обращаться к модели нечем.")

        model = self.model_for(kind)
        safe_payload = pseudonymize(payload)
        # Свободный текст пишет человек, и «это же его собственный ввод» —
        # не оговорка к запрету контактов в промптах (ADR-0019).
        safe_text = scrub_free_text(user_text)

        reserved = reserve_cost(
            model, max_tokens=max_tokens, prompt_tokens_guess=_prompt_tokens_guess(safe_payload)
        )

        async with self._sessionmaker() as session:
            # Проверка и запись — под одной блокировкой: иначе одновременные
            # задачи читают одинаковый расход и проходят предохранитель разом.
            await jobs_repo.lock_budget(session)
            await self._assert_within_limits(session, requested_by=requested_by, kind=kind)
            job = await jobs_repo.create(
                session,
                kind=kind,
                requested_by=requested_by,
                patient_id=patient_id,
                payload={"payload": safe_payload, "user_text": safe_text},
                model=model,
                reserved_cost_usd=reserved,
            )
            job_id = job.id
            await session.commit()

        content: list[dict[str, Any]] = [
            {"type": "text", "text": json.dumps(safe_payload, ensure_ascii=False, sort_keys=True)}
        ]
        if safe_text:
            content.append({"type": "text", "text": safe_text})

        try:
            response = await self._anthropic.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
                timeout=timeout_s,
            )
        except Exception as error:  # noqa: BLE001 — наружу идёт один понятный тип
            await self._finish_failed(job_id, error=str(error))
            raise AiUnavailable("Модель не ответила.") from error

        tokens_in, tokens_out = _usage_of(response)
        cost = estimate_cost(model, tokens_in=tokens_in, tokens_out=tokens_out)
        text = _text_of(response)

        if text is None:
            # Ответ пришёл, но текста в нём нет — например, модель отказалась
            # (`stop_reason: refusal`). Токены при этом потрачены, и записать их
            # обязательно: иначе бюджет не увидит расхода.
            await self._finish_failed(
                job_id,
                error=f"Модель не вернула текст: stop_reason={getattr(response, 'stop_reason', None)}",
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost=cost,
            )
            raise AiUnavailable("Модель не вернула ответ.")

        async with self._sessionmaker() as session:
            stored = await jobs_repo.get(session, job_id)
            if stored is not None:
                await jobs_repo.mark_done(
                    session,
                    job=stored,
                    output={"text": text},
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost_usd=cost,
                )
                await session.commit()

        return AiAnswer(
            job_id=job_id,
            text=text,
            model=model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
        )

    async def _assert_within_limits(
        self, session: Any, *, requested_by: uuid.UUID, kind: AiJobKind
    ) -> None:
        since = self._day_start()

        spent = await jobs_repo.cost_since(session, since=since)
        if spent >= Decimal(str(self._settings.ai_daily_budget_usd)):
            raise AiLimitExceeded(
                "Дневной лимит ИИ-помощника исчерпан. Он обновится завтра — "
                "остальные разделы работают как обычно."
            )

        if kind in USER_LIMITED_KINDS:
            asked = await jobs_repo.count_since(
                session, requested_by=requested_by, kinds=USER_LIMITED_KINDS, since=since
            )
            if asked >= self._settings.ai_user_daily_limit:
                raise AiLimitExceeded(
                    "На сегодня вопросов к помощнику больше нет — они появятся снова завтра."
                )

    def _day_start(self) -> datetime:
        """Начало суток по часовому поясу проекта, в UTC.

        Не «последние 24 часа»: и бюджет, и предел пользователя человек понимает
        как «на сегодня», а сутки у семьи начинаются в её полночь, а не в
        полночь UTC — в Ташкенте это разные дни.
        """

        zone = ZoneInfo(self._settings.tz)
        local_midnight = datetime.combine(datetime.now(zone).date(), time.min, tzinfo=zone)
        return local_midnight.astimezone(UTC)

    async def _finish_failed(
        self,
        job_id: uuid.UUID,
        *,
        error: str,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        cost: Decimal | None = None,
    ) -> None:
        async with self._sessionmaker() as session:
            job = await jobs_repo.get(session, job_id)
            if job is not None:
                await jobs_repo.mark_failed(
                    session,
                    job=job,
                    error=error,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost_usd=cost,
                )
                await session.commit()


#: Грубая оценка «символов на токен» для брони.
#:
#: Не `count_tokens`: он сам ходит в сеть, а бронь нужна ДО вызова и на каждый
#: вызов. Оценка нужна не для отчёта, а чтобы бронь не была нулевой; настоящее
#: число придёт с ответом и заменит её.
_CHARS_PER_TOKEN = 3


def _prompt_tokens_guess(payload: Any) -> int:
    return max(len(json.dumps(payload, ensure_ascii=False)) // _CHARS_PER_TOKEN, 1)


def _usage_of(response: Any) -> tuple[int | None, int | None]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None, None
    tokens_in = getattr(usage, "input_tokens", None)
    tokens_out = getattr(usage, "output_tokens", None)
    return tokens_in, tokens_out


def _text_of(response: Any) -> str | None:
    """Текст ответа: блоки бывают разных типов, и `content[0]` — не текст.

    У модели с включённым размышлением первым блоком идёт `thinking`, и слепое
    обращение к первому блоку вернуло бы пустую строку (или упало).
    """

    blocks = getattr(response, "content", None) or []
    parts = [
        block.text
        for block in blocks
        if getattr(block, "type", None) == "text" and getattr(block, "text", None)
    ]
    return "\n".join(parts) if parts else None


def build_ai_client(settings: Settings | None = None) -> AiClient:
    """Собранный клиент для задач воркера.

    Сборка в одном месте: задача не должна знать ни про sessionmaker, ни про
    ретраи SDK — иначе следующая задача соберёт его чуть иначе.
    """

    from core.db import get_sessionmaker

    resolved = settings or Settings()  # type: ignore[call-arg]
    return AiClient(
        sessionmaker=get_sessionmaker(),
        anthropic=build_anthropic(resolved),
        settings=resolved,
    )


def build_anthropic(settings: Settings) -> AnthropicLike:
    """Настоящий SDK-клиент. Импорт внутри функции — по той же причине, что у
    weasyprint в отчётах: пакет не нужен задачам, которые к модели не ходят."""

    from anthropic import AsyncAnthropic

    # `messages.create` у SDK — набор перегрузок с обязательными параметрами, и
    # структурно он не совпадает с нашим протоколом, хотя вызывается ровно так.
    # Приведение здесь, а не протокол «под SDK»: протокол существует ради тестов,
    # которым нужно подставить свою реализацию, не выходя в сеть.
    return cast(
        AnthropicLike,
        AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            max_retries=MAX_RETRIES,
            timeout=DEFAULT_TIMEOUT_S,
        ),
    )
