"""Единственная дверь к Claude API (раздел 10.2 ТЗ, правило 6 `CLAUDE.md`).

Здесь сходится всё, что должно случаться при КАЖДОМ обращении к модели и о чём
нельзя вспоминать в каждой задаче отдельно:

- псевдонимизация нагрузки (`pseudonymize`) — обойти её, не переписав этот
  модуль, нельзя;
- предохранители: бюджеты проекта и группы задач (день и месяц), суточный
  предел человека в группе, выключатель группы (ADR-0080);
- строка в `ai_jobs` — до вызова, чтобы след остался даже если процесс умрёт,
  и с токенами и стоимостью после, включая неудачу;
- ключ и имя модели — из настроек администратора, запасным — из окружения
  (`ANTHROPIC_API_KEY`, `AI_MODEL_FAST` / `AI_MODEL_SMART`), но не из кода;
- ретраи и таймаут.

Чего здесь нет намеренно: промптов и разбора ответа. Промпты живут файлами в
`prompts/` и меняются отдельным PR (раздел 10.4 ТЗ), разбор — дело задачи,
которая знает, чего просила. Клиент отвечает за «как обратиться», а не «о чём».
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol, cast

from sqlalchemy.ext.asyncio import async_sessionmaker

from core import app_settings
from core.app_settings import AI_TASKS, AiConfig
from core.config import Settings
from core.models.enums import AiJobKind
from core.repositories import ai_jobs as jobs_repo

from .pricing import UnknownModelPrice, assert_priced, estimate_cost, reserve_cost
from .pseudonymize import pseudonymize, scrub_free_text

# Which tasks count against the per-person limit and which take the fast model
# is declared once, in `core.app_settings.AI_TASKS`: the admin area shows the
# same table it is enforced by.

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
    """Ключа или имени модели нет ни в настройках, ни в окружении — обращаться некуда."""


class AiDisabled(NotConfigured):
    """Администратор выключил группу задач (ADR-0080).

    Подкласс `NotConfigured`: для человека это то же «сейчас недоступно», и
    каждая задача уже умеет так отвечать.
    """


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
        settings: Settings,
        anthropic: AnthropicLike | None = None,
        anthropic_for_key: Callable[[str], AnthropicLike] | None = None,
    ) -> None:
        """`anthropic` — готовый клиент (тесты); иначе он собирается под ключ,
        который действует на момент вызова: администратор мог его заменить."""

        self._sessionmaker = sessionmaker
        self._settings = settings
        self._fixed = anthropic
        self._for_key = anthropic_for_key or build_anthropic_for_key
        self._built: tuple[str, AnthropicLike] | None = None

    def _sdk(self, api_key: str) -> AnthropicLike:
        if self._fixed is not None:
            return self._fixed
        if self._built is None or self._built[0] != api_key:
            self._built = (api_key, self._for_key(api_key))
        return self._built[1]

    @staticmethod
    def model_for(kind: AiJobKind, config: AiConfig) -> str:
        """Имя модели группы задач. Пустое значение — отказ, а не подстановка.

        Подставить сюда имя по умолчанию значит зашить его в код: правило 6
        `CLAUDE.md` запрещает именно это, а молчаливая подстановка ещё и уводит
        расходы на модель, которую никто не выбирал.
        """

        group = config.group_of(kind)
        model = group.model_for(kind)
        variable = "AI_MODEL_FAST" if AI_TASKS[kind].speed == "fast" else "AI_MODEL_SMART"
        if not model:
            raise NotConfigured(
                f"Модель группы «{group.group.value}» не выбрана в разделе «ИИ» и не задана "
                f"переменной {variable} — обращаться не к какой модели."
            )

        # Модель без цены — это выключенный бюджет: стоимость её вызовов
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

        safe_payload = pseudonymize(payload)
        # Свободный текст пишет человек, и «это же его собственный ввод» —
        # не оговорка к запрету контактов в промптах (ADR-0019).
        safe_text = scrub_free_text(user_text)

        async with self._sessionmaker() as session:
            config = await app_settings.ai_config(session, self._settings)
            if not config.api_key:
                raise NotConfigured(
                    "Ключ ИИ не задан ни в разделе «ИИ», ни в ANTHROPIC_API_KEY — "
                    "обращаться к модели нечем."
                )
            if not config.group_of(kind).enabled:
                raise AiDisabled("Эта функция ИИ выключена администратором.")
            model = self.model_for(kind, config)

            reserved = reserve_cost(
                model,
                max_tokens=max_tokens,
                prompt_tokens_guess=_prompt_tokens_guess(safe_payload),
            )

            # Проверка и запись — под одной блокировкой: иначе одновременные
            # задачи читают одинаковый расход и проходят предохранитель разом.
            await jobs_repo.lock_budget(session)
            await self._assert_within_limits(
                session, config=config, requested_by=requested_by, kind=kind
            )
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

        sdk = self._sdk(config.api_key)
        content: list[dict[str, Any]] = [
            {"type": "text", "text": json.dumps(safe_payload, ensure_ascii=False, sort_keys=True)}
        ]
        if safe_text:
            content.append({"type": "text", "text": safe_text})

        try:
            response = await sdk.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
                timeout=timeout_s,
            )
        except Exception as error:  # noqa: BLE001 — наружу идёт один понятный тип
            await self._finish_failed(job_id, error=_describe_failure(error))
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
        self,
        session: Any,
        *,
        config: AiConfig,
        requested_by: uuid.UUID,
        kind: AiJobKind,
    ) -> None:
        """Бюджеты — по расходу, предел человека — по числу обращений.

        Порядок проверок — от общего к частному, и тексты разные: семье, чей
        помощник упёрся в бюджет СВОЕЙ группы, незачем слышать про проект.
        """

        day = app_settings.day_start(self._settings.tz)
        month = app_settings.month_start(self._settings.tz)
        group = config.group_of(kind)
        group_kinds = app_settings.kinds_of(group.group)

        exhausted_today = AiLimitExceeded(
            "Дневной лимит ИИ-помощника исчерпан. Он обновится завтра — "
            "остальные разделы работают как обычно."
        )
        exhausted_month = AiLimitExceeded(
            "Месячный лимит ИИ исчерпан. Администратор может его поднять — "
            "остальные разделы работают как обычно."
        )

        if await jobs_repo.cost_since(session, since=day) >= config.daily_budget_usd:
            raise exhausted_today
        if config.monthly_budget_usd is not None and (
            await jobs_repo.cost_since(session, since=month) >= config.monthly_budget_usd
        ):
            raise exhausted_month
        if group.daily_budget_usd is not None and (
            await jobs_repo.cost_since(session, since=day, kinds=group_kinds)
            >= group.daily_budget_usd
        ):
            raise exhausted_today
        if group.monthly_budget_usd is not None and (
            await jobs_repo.cost_since(session, since=month, kinds=group_kinds)
            >= group.monthly_budget_usd
        ):
            raise exhausted_month

        if AI_TASKS[kind].per_person:
            limited = tuple(k for k in group_kinds if AI_TASKS[k].per_person)
            asked = await jobs_repo.count_since(
                session, requested_by=requested_by, kinds=limited, since=day
            )
            if asked >= group.user_daily_limit:
                raise AiLimitExceeded(
                    "На сегодня вопросов к помощнику больше нет — они появятся снова завтра."
                )

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
    return AiClient(sessionmaker=get_sessionmaker(), settings=resolved)


def build_anthropic_for_key(api_key: str) -> AnthropicLike:
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
            api_key=api_key,
            max_retries=MAX_RETRIES,
            timeout=DEFAULT_TIMEOUT_S,
        ),
    )


#: Сколько текста исключения сохранять в журнал.
_ERROR_CHARS = 300


def _describe_failure(error: BaseException) -> str:
    """Причина неудачи для `ai_jobs.error` — без содержимого запроса.

    `str(error)` у транспортных исключений иногда разворачивает объект запроса
    вместе с заголовками, а среди них `x-api-key`. Журнал вызовов читают люди, и
    ключ, однажды попавший в строку таблицы, оттуда уже не вынуть: он поедет в
    бэкап, в выгрузку, в разбор инцидента.
    """

    text = f"{type(error).__name__}: {error}"[:_ERROR_CHARS]
    return _SECRETS.sub("[скрыто]", text)


#: Что вырезается: значения заголовков с ключами и любые строки вида `sk-...`.
_SECRETS = re.compile(
    r"(?i)(x-api-key|authorization|api[_-]?key)\s*[:=]\s*\S+|sk-[A-Za-z0-9_\-]{8,}"
)
