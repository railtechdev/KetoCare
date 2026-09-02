"""Разбор свободного текста (раздел 10.3 ТЗ, п. 19 этапа 4).

Родитель пишет «Аня съела 30 г масла и одно яйцо» — модель превращает это в
позиции дневника. Три вещи здесь важнее остальных:

1. **Результат не сохраняется.** Он показывается человеку, и запись появляется
   только после «Подтвердить» (правило 6 `CLAUDE.md`). Эта функция ничего в
   клинические таблицы не пишет — она возвращает черновик.
2. **`product_id` проверяется по списку, который мы сами и передали.** Модель
   может придумать правдоподобный идентификатор, и выглядел бы он как
   настоящий: попал бы в дневник питания и в расчёт кетосоотношения. Поэтому
   идентификатор не из списка — это невалидный ответ, а не «почти верный».
3. **Один повтор, потом вопрос человеку.** Раздел 10.3 ТЗ: невалидный ответ →
   повтор с указанием ошибки; второй провал → `clarification_needed`. Повтор —
   это отдельное обращение к модели, и в журнале `ai_jobs` оно отдельной
   строкой: оно и стоило отдельно.
"""

from __future__ import annotations

import json
import re
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from core.models.enums import AiJobKind
from core.repositories import ai_jobs as jobs_repo
from core.repositories import products as products_repo

from .client import AiClient, AiError, AiLimitExceeded

#: Сколько продуктов уходит в промпт.
#:
#: Весь справочник не отправляется: он растёт, а токены платные. Отбор — по
#: словам самой фразы (раздел 10.3 ТЗ: «top-N по префиксному совпадению»).
MAX_PRODUCTS = 40

#: Слова короче трёх букв не ищутся: «на», «и», «в» дают весь справочник.
MIN_WORD = 3

_WORD = re.compile(rf"[^\W\d_]{{{MIN_WORD},}}", re.UNICODE)


class ParsedItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str
    grams: float = Field(gt=0, le=5000)
    #: Насколько модель уверена в граммовке. Показывается человеку: «два яйца»
    #: — это оценка, и родитель должен видеть, что её надо проверить.
    confidence: float = Field(ge=0, le=1)
    #: Название продукта — подставляет сервер, не модель.
    #:
    #: Без него подтверждение выглядело бы как «3f2a1c9d… 30 г»: родитель не
    #: может проверить то, чего не читает, а подтверждение без проверки —
    #: не человек в контуре, а кнопка «согласен» (правило 6 CLAUDE.md).
    #: Модели название не доверяем: она вернула бы своё, а не справочное.
    name_ru: str | None = None


class ParsedMeal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ParsedItem] = []
    #: Названия из фразы, которых нет в справочнике, — словами родителя.
    unmatched: list[str] = []


class ParsedSeizure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type_hint: str | None = None
    duration_sec: int | None = Field(default=None, ge=0, le=24 * 3600)
    count: int | None = Field(default=None, ge=0, le=100)


class ParseResult(BaseModel):
    """Выход раздела 10.3 ТЗ — ровно он, без добавлений."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["meal", "seizure", "other"]
    meal: ParsedMeal | None = None
    seizure: ParsedSeizure | None = None
    clarification_needed: str | None = None


class ProductOption(BaseModel):
    id: str
    name: str


@lru_cache(maxsize=1)
def prompt() -> str:
    """Системный промпт — файлом, а не строкой в коде (раздел 10.4 ТЗ).

    Читается один раз: файл не меняется без перезапуска, а промпт уходит в
    каждый запрос.
    """

    return (Path(__file__).parent / "prompts" / "parse_free_text.md").read_text(encoding="utf-8")


async def collect_products(session: AsyncSession, *, text: str) -> list[ProductOption]:
    """Продукты-кандидаты по словам фразы.

    Активное назначение сюда не передаётся намеренно (раздел 10.3 ТЗ): модель
    разбирает, что человек написал, а не подгоняет ответ под цель — иначе она
    начнёт «помогать» и подберёт граммовку под кетосоотношение.
    """

    found: dict[str, str] = {}
    for word in dict.fromkeys(_WORD.findall(text.lower())):
        products, _ = await products_repo.search(session, q=word, limit=MAX_PRODUCTS)
        for product in products:
            found.setdefault(str(product.id), product.name_ru)
            if len(found) >= MAX_PRODUCTS:
                return [ProductOption(id=pid, name=name) for pid, name in found.items()]

    return [ProductOption(id=pid, name=name) for pid, name in found.items()]


class Parsed(BaseModel):
    """Черновик разбора и строка журнала, из которой он взялся.

    Идентификатор задачи нужен снаружи: подтверждение записывается по нему, а не
    по присланной клиентом структуре (иначе структуру можно подменить).
    """

    result: ParseResult
    ai_job_id: uuid.UUID


async def parse(
    client: AiClient,
    *,
    requested_by: uuid.UUID,
    patient_id: uuid.UUID,
    text: str,
    products: list[ProductOption],
) -> Parsed:
    """Разобрать фразу. Возвращает черновик — сохранять его будет человек."""

    payload: dict[str, Any] = {"products": [product.model_dump() for product in products]}
    catalogue = {product.id: product.name for product in products}

    complaint: str | None = None
    for attempt in (1, 2):
        try:
            answer = await client.ask(
                kind=AiJobKind.PARSE_MEAL,
                requested_by=requested_by,
                patient_id=patient_id,
                system=prompt(),
                payload=payload,
                user_text=text if complaint is None else f"{text}\n\n{complaint}",
            )
        except AiError:
            # Предел, бюджет или недоступность — не наше дело: ручка расскажет
            # человеку своими словами, а бот предложит выбрать из меню.
            raise

        try:
            return Parsed(
                result=_validated(answer.text, catalogue=catalogue), ai_job_id=answer.job_id
            )
        except ValueError as error:
            if attempt == 2:
                break
            # Повтор с указанием ошибки — раздел 10.3 ТЗ. Текст ошибки идёт
            # модели как есть: она поправит то, что назвали, а не угадает.
            complaint = (
                f"Твой прошлый ответ не подошёл: {error}. Верни только JSON по описанной схеме."
            )

    # Два раза подряд не получилось — значит, вопрос человеку, а не молчание и
    # не пустая запись, которую он примет за разбор.
    return Parsed(
        result=ParseResult(
            kind="other",
            clarification_needed=(
                "Не удалось разобрать запись. Напишите, что и сколько ребёнок съел."
            ),
        ),
        ai_job_id=answer.job_id,
    )


def _validated(raw: str, *, catalogue: dict[str, str]) -> ParseResult:
    """JSON модели → структура ТЗ, с проверкой того, что мы ей давали."""

    try:
        data = json.loads(_without_fence(raw))
    except json.JSONDecodeError as error:
        raise ValueError(f"это не JSON ({error.msg})") from error

    try:
        result = ParseResult.model_validate(data)
    except ValidationError as error:
        raise ValueError(_first_problem(error)) from error

    unknown = [
        item.product_id
        for item in (result.meal.items if result.meal else [])
        if item.product_id not in catalogue
    ]
    if unknown:
        # Придуманный идентификатор выглядит как настоящий и попал бы в дневник
        # питания молча — вместе с чужими жирами и белками в расчёте.
        raise ValueError(f"product_id {', '.join(unknown)} нет в переданном списке products")

    # Название — из справочника, а не из ответа модели: показать человеку надо
    # то, что лежит в базе и по чему потом считается раскладка.
    for item in result.meal.items if result.meal else []:
        item.name_ru = catalogue[item.product_id]

    return result


def _without_fence(raw: str) -> str:
    """Снять ```json-ограду, если модель всё-таки её поставила.

    Промпт просит без неё, но повтор из-за одной обёртки стоил бы второго
    обращения к модели — а содержимое при этом верное.
    """

    text = raw.strip()
    if not text.startswith("```"):
        return text
    without_open = text.split("\n", 1)[1] if "\n" in text else ""
    return without_open.rsplit("```", 1)[0].strip()


def _first_problem(error: ValidationError) -> str:
    problem = error.errors()[0]
    where = ".".join(str(part) for part in problem["loc"]) or "корень"
    return f"поле {where}: {problem['msg']}"


async def parse_free_text(
    ctx: dict[str, Any], requested_by: str, patient_id: str, text: str
) -> dict[str, Any]:
    """Задача ARQ. Ручка `POST /ai/parse` ждёт её ответа синхронно (раздел 10.1).

    Доступ к ребёнку проверяет ручка — здесь для этого нет ни токена, ни
    контекста запроса, и делать вид, что проверка возможна, нельзя.

    Отказы возвращаются **значением**, а не исключением: `apps/api` не зависит
    от `apps/worker` и распаковать его классы не может — исключение приехало бы
    к ней неузнаваемым. Поэтому наружу идёт конверт со `status`.
    """

    from core.db import get_sessionmaker

    from .client import build_ai_client

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        products = await collect_products(session, text=text)

    try:
        parsed = await parse(
            build_ai_client(),
            requested_by=uuid.UUID(requested_by),
            patient_id=uuid.UUID(patient_id),
            text=text,
            products=products,
        )
    except AiLimitExceeded as error:
        return {"status": "limited", "message": str(error)}
    except AiError as error:
        # Недоступность или ненастроенность — для человека это одно и то же:
        # «сейчас не получится, попробуйте позже или выберите из меню».
        return {"status": "unavailable", "message": str(error)}

    # Что мы приняли — в журнал рядом с сырым ответом: подтверждение записи
    # берётся оттуда, а не из того, что пришлёт клиент.
    async with sessionmaker() as session:
        job = await jobs_repo.get(session, parsed.ai_job_id)
        if job is not None:
            await jobs_repo.attach_parsed(session, job=job, parsed=parsed.result.model_dump())
            await session.commit()

    return {
        "status": "ok",
        "ai_job_id": str(parsed.ai_job_id),
        "result": parsed.result.model_dump(),
    }
