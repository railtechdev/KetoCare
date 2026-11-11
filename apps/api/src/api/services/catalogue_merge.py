"""Слияние справочников-источников в рабочий справочник клиники (ADR-0067, ADR-0068).

Строка рабочего справочника собирается по порядку источников: каждое число
берётся из первого источника, где оно известно (не прочерк). Записи разных
стандартов — один продукт, если у них общий `food_id`.

Решения, которые стоит знать до правок (ADR-0068):

- **Углеводы источника без явного «с клетчаткой» считаются чистыми.** Советские
  таблицы приводят усвояемые углеводы без пищевых волокон. В рабочий справочник
  ложится `углеводы источника + выбранная клетчатка`: ядро вычитает клетчатку
  само (ADR-0030), и без прибавки она была бы вычтена дважды. Если таблица на
  деле давала общие углеводы, прибавка завышает углеводы и ЗАНИЖАЕТ
  соотношение — это безопасная сторона; обратное правило могло бы его завысить.
- **Нет жиров, белков, углеводов или калорийности ни в одном источнике — строка
  не пишется.** В стандарте клиники по ним считают еду ребёнку, а ноль на месте
  «нет данных» ушёл бы в расчёт как настоящее число.
- **Строка, не прошедшая проверку 9–4–4, сама не пишется**: числа из разных
  таблиц могут не сойтись, и решает диетолог (`accept`).
- **Правка человека сильнее слияния.** Число с источником `manual` не
  перезаписывается; если источники дают другое — это расхождение, его видно,
  но оно не применяется.
- **Число без отслеженного источника тоже не перезаписывается.** Строки
  основного стандарта, заведённые до `value_sources` (сиды, форма, импорт),
  пометки `manual` не несут, хотя их вписал человек. Перезаписывается только
  число, которое положила запись источника (`kind = product`: слияние или
  копия); остальное — расхождение, как правка.
- **Одна строка цели — одному продукту.** Совпадение по названию с уже
  занятой строкой или второй новой строкой того же названия — расхождение
  без записи (`name_taken`), а не перезапись и не отказ уникального индекса.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from core.clock import local_today
from core.models import FoodStandard, Product
from core.models.enums import CarbsConvention
from core.repositories import products as products_repo

from . import product_checks

MergeStatus = Literal["new", "update", "unchanged", "needs_review", "no_data", "conflict"]

#: Поля, которые собирает слияние, в порядке показа.
VALUE_FIELDS = ("kcal_100g", "fat_100g", "protein_100g", "carbs_100g", "fiber_100g", "waste_pct")

#: Без этих чисел строка в стандарт клиники не ложится (инвариант репозитория
#: плюс калорийность: без неё нечего сверять по 9–4–4).
REQUIRED_FIELDS = ("kcal_100g", "fat_100g", "protein_100g", "carbs_100g")

#: Дополнительная находка сверх `product_checks`: клетчатка из одного источника
#: больше углеводов из другого. Чистые углеводы ушли бы в ноль молча.
FIBER_EXCEEDS_CARBS = "fiber_exceeds_carbs"

#: Название уже занято в цели другим продуктом — строка не пишется.
NAME_TAKEN = "name_taken"


@dataclass(frozen=True, slots=True)
class Source:
    """Стандарт-источник в порядке слияния."""

    id: uuid.UUID
    name: str
    #: Углеводы записаны без клетчатки или неизвестно как — читаются чистыми.
    carbs_net: bool

    @classmethod
    def of(cls, standard: FoodStandard) -> Source:
        return cls(
            id=standard.id,
            name=standard.name,
            carbs_net=standard.carbs_convention is not CarbsConvention.TOTAL,
        )


@dataclass(slots=True)
class FieldValue:
    """Итоговое число поля и откуда оно взято."""

    value: float | None
    source: Source | None = None
    product_id: uuid.UUID | None = None
    #: Число вписал человек или его источник не отслежен; слияние его не трогает.
    manual: bool = False
    #: Источник числа не отслежен (строка заведена до `value_sources`).
    untracked: bool = False
    #: Число человека расходится с тем, что дают источники.
    conflict: bool = False
    #: Что дали бы источники (при `manual`).
    merged: float | None = None
    #: Углеводы источника прочитаны чистыми, к ним прибавлена клетчатка.
    net_plus_fiber: bool = False


@dataclass(slots=True)
class MergeRow:
    food_id: uuid.UUID
    name_ru: str
    status: MergeStatus
    #: Будет записана (в превью) или записана (при применении).
    write: bool
    accepted: bool
    target: Product | None
    template: Product
    fields: dict[str, FieldValue]
    anomalies: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    fiber_known: bool = False
    #: Что записать: поля продукта для `create`/`update`.
    changes: dict[str, Any] = field(default_factory=dict)
    contributing: list[Source] = field(default_factory=list)


def _known(product: Product, name: str) -> bool:
    if name == "waste_pct":
        return product.waste_pct is not None
    unknown = product.unknown_fields or []
    if name == "fiber_100g":
        return bool(product.fiber_known) and name not in unknown
    return name not in unknown


def _number(value: Any) -> float | None:
    return None if value is None else round(float(value), 2)


def _is_manual(target: Product | None, name: str) -> bool:
    """Число цели защищено от слияния: его положил не источник.

    Защищено всё, что не помечено `kind = product`, — и правка (`manual`), и
    число без пометки. Пустые отходы защищать нечего: их можно заполнить.
    """

    if target is None:
        return False
    if name == "waste_pct" and target.waste_pct is None:
        return False
    entry = (target.value_sources or {}).get(name)
    return not (isinstance(entry, dict) and entry.get("kind") == "product")


def _is_untracked(target: Product | None, name: str) -> bool:
    if target is None:
        return False
    entry = (target.value_sources or {}).get(name)
    return not isinstance(entry, dict)


def merge_food(
    food_id: uuid.UUID,
    present: Sequence[tuple[Source, Product]],
    target: Product | None,
    *,
    accepted: bool,
) -> MergeRow:
    """Одна строка рабочего справочника из записей источников по порядку.

    Чистая функция: ничего не пишет, только решает. `present` — записи этого
    продукта в источниках, уже в порядке слияния.
    """

    picks: dict[str, tuple[Source, Product] | None] = {
        name: next(((source, p) for source, p in present if _known(p, name)), None)
        for name in VALUE_FIELDS
    }

    fields: dict[str, FieldValue] = {}

    def proposed(name: str) -> FieldValue:
        pick = picks[name]
        if pick is None:
            return FieldValue(value=None)
        source, product = pick
        return FieldValue(
            value=_number(getattr(product, name)), source=source, product_id=product.id
        )

    for name in ("kcal_100g", "fat_100g", "protein_100g", "fiber_100g", "waste_pct"):
        fields[name] = proposed(name)

    # Клетчатка, которая окажется в строке: правка человека сильнее источника.
    if _is_manual(target, "fiber_100g"):
        assert target is not None
        fiber = float(target.fiber_100g)
        fiber_known = bool(target.fiber_known)
    else:
        fiber = fields["fiber_100g"].value or 0.0
        fiber_known = fields["fiber_100g"].value is not None
        if not fiber_known:
            # Неизвестная клетчатка лежит нулём (`fiber_known = false`):
            # соотношение не завышается — осторожная сторона.
            fields["fiber_100g"] = FieldValue(value=0.0)

    carbs_pick = picks["carbs_100g"]
    if carbs_pick is None:
        fields["carbs_100g"] = FieldValue(value=None)
    else:
        source, product = carbs_pick
        raw = float(product.carbs_100g)
        fields["carbs_100g"] = FieldValue(
            value=round(raw + fiber, 2) if source.carbs_net else round(raw, 2),
            source=source,
            product_id=product.id,
            # Пометка — только если что-то прибавлено: «+ клетчатка» при нуле
            # обещала бы поправку, которой не было.
            net_plus_fiber=source.carbs_net and fiber > 0,
        )

    # Правка человека: число остаётся, расхождение показывается.
    for name in VALUE_FIELDS:
        if not _is_manual(target, name):
            continue
        assert target is not None
        current = _number(getattr(target, name))
        merged = fields[name]
        fields[name] = FieldValue(
            value=current,
            manual=True,
            untracked=_is_untracked(target, name),
            merged=merged.value,
            conflict=merged.value is not None and merged.value != current,
        )

    template = present[0][1]
    missing = [name for name in REQUIRED_FIELDS if fields[name].value is None]
    contributing: list[Source] = []
    for name in VALUE_FIELDS:
        origin = fields[name].source
        if origin is not None and origin not in contributing:
            contributing.append(origin)

    row = MergeRow(
        food_id=food_id,
        name_ru=target.name_ru if target is not None else template.name_ru,
        status="unchanged",
        write=False,
        accepted=accepted,
        target=target,
        template=template,
        fields=fields,
        missing=missing,
        fiber_known=fiber_known,
        contributing=contributing,
    )
    if missing:
        row.status = "no_data"
        return row

    values = {name: fields[name].value for name in VALUE_FIELDS}
    kcal, fat, protein, carbs = (float(values[name] or 0) for name in REQUIRED_FIELDS)
    # Сверка 9–4–4 по ЧИСТЫМ углеводам: так их считает ядро (ADR-0030).
    checked = product_checks.Values(
        kcal=kcal, fat=fat, protein=protein, carbs=max(carbs - fiber, 0.0), fiber=fiber
    )
    row.anomalies = [str(finding.kind) for finding in product_checks.check(checked)]
    if fiber > carbs:
        row.anomalies.append(FIBER_EXCEEDS_CARBS)

    row.changes = _changes(target, fields, fiber_known=fiber_known)
    has_changes = target is None or bool(row.changes)
    conflicts = any(value.conflict for value in fields.values())

    if row.anomalies:
        row.status = "needs_review"
        row.write = accepted and has_changes
    elif conflicts:
        row.status = "conflict"
        row.write = has_changes
    elif target is None:
        row.status = "new"
        row.write = True
    elif has_changes:
        row.status = "update"
        row.write = True
    return row


def _source_entry(value: FieldValue) -> dict[str, Any]:
    entry: dict[str, Any] = {"kind": "product", "product_id": str(value.product_id)}
    if value.net_plus_fiber:
        entry["net_plus_fiber"] = True
    return entry


def _changes(
    target: Product | None, fields: dict[str, FieldValue], *, fiber_known: bool
) -> dict[str, Any]:
    """Поля продукта, которые слияние меняет (для новой строки — все)."""

    previous = dict(target.value_sources or {}) if target is not None else {}
    sources = dict(previous)
    values: dict[str, Any] = {}
    for name, value in fields.items():
        if value.manual:
            continue
        if name == "waste_pct" and value.value is None and target is not None:
            # Источники отходов не знают — известное значение цели остаётся.
            continue
        if value.product_id is None:
            sources.pop(name, None)
        else:
            sources[name] = _source_entry(value)
        if name == "waste_pct":
            values[name] = None if value.value is None else Decimal(str(value.value))
        else:
            values[name] = value.value

    if target is None:
        return {**values, "fiber_known": fiber_known, "value_sources": sources}

    changes: dict[str, Any] = {
        name: new for name, new in values.items() if _number(getattr(target, name)) != _number(new)
    }
    if not fields["fiber_100g"].manual and bool(target.fiber_known) != fiber_known:
        changes["fiber_known"] = fiber_known
    if target.unknown_fields:
        changes["unknown_fields"] = []
    if sources != previous:
        changes["value_sources"] = sources
    return changes


@dataclass(slots=True)
class MergePlan:
    rows: list[MergeRow]


async def plan(
    session: AsyncSession,
    *,
    target: FoodStandard,
    sources: Sequence[FoodStandard],
    accept: Collection[uuid.UUID],
) -> MergePlan:
    """Превью: что слияние сделает с каждым продуктом источников."""

    ordered = [Source.of(standard) for standard in sources]
    rank = {source.id: index for index, source in enumerate(ordered)}
    by_id = {source.id: source for source in ordered}

    source_rows = await products_repo.list_in_standards(session, standard_ids=list(by_id))
    target_rows = await products_repo.list_in_standards(session, standard_ids=[target.id])

    by_food: dict[uuid.UUID, dict[uuid.UUID, Product]] = {}
    for product in source_rows:
        if not product.is_active:
            continue
        # Внутри стандарта у продукта одна запись; на случай двух — первая по имени.
        by_food.setdefault(product.food_id, {}).setdefault(product.standard_id, product)

    target_by_food: dict[uuid.UUID, Product] = {}
    target_by_name: dict[str, Product] = {}
    for product in target_rows:
        target_by_food.setdefault(product.food_id, product)
        target_by_name.setdefault(product.name_ru.casefold().strip(), product)

    accepted = set(accept)
    rows: list[MergeRow] = []
    groups = [
        (
            food_id,
            sorted(
                ((by_id[standard_id], product) for standard_id, product in records.items()),
                key=lambda item: rank[item[0].id],
            ),
        )
        for food_id, records in by_food.items()
    ]
    # Совпадение по `food_id` надёжнее совпадения по названию: такие строки
    # занимают цель первыми.
    claimed: set[uuid.UUID] = {food_id for food_id, _ in groups if food_id in target_by_food}
    claimed_targets = {target_by_food[food_id].id for food_id in claimed}
    new_names: set[str] = set()
    for food_id, present in groups:
        name = present[0][1].name_ru.casefold().strip()
        taken = False
        existing = target_by_food.get(food_id)
        if existing is None:
            by_name = target_by_name.get(name)
            if by_name is not None:
                if by_name.id in claimed_targets:
                    taken = True
                else:
                    existing = by_name
                    claimed_targets.add(by_name.id)
            elif name in new_names:
                taken = True
            else:
                new_names.add(name)
        row = merge_food(
            food_id, present, None if taken else existing, accepted=food_id in accepted
        )
        if taken:
            # Строка с этим названием уже занята другим продуктом: запись
            # перезаписала бы её или упёрлась в уникальный индекс.
            row.status = "conflict"
            row.write = False
            row.anomalies.append(NAME_TAKEN)
        rows.append(row)

    rows.sort(key=lambda row: row.name_ru.casefold())
    return MergePlan(rows=rows)


def _signature(row: MergeRow) -> tuple[str, str]:
    names = " + ".join(source.name for source in row.contributing)
    return f"Слияние: {names}"[:255], f"слияние {local_today().isoformat()}"


async def apply(
    session: AsyncSession, *, target: FoodStandard, plan: MergePlan, changed_by: uuid.UUID
) -> None:
    """Записывает строки плана, у которых `write`. Ревизии пишет репозиторий."""

    for row in plan.rows:
        if not row.write:
            continue
        source, version = _signature(row)
        if row.target is None:
            template = row.template
            await products_repo.create(
                session,
                changed_by=changed_by,
                standard_id=target.id,
                food_id=row.food_id,
                name_ru=template.name_ru,
                name_uz=template.name_uz,
                name_en=template.name_en,
                category_id=template.category_id,
                counts_in_calculation=template.counts_in_calculation,
                unknown_fields=[],
                source=source,
                source_version=version,
                verified_at=local_today(),
                **row.changes,
            )
        else:
            changes = dict(row.changes)
            if any(name in changes for name in VALUE_FIELDS):
                changes.update(source=source, source_version=version, verified_at=local_today())
            await products_repo.update(
                session, product=row.target, changed_by=changed_by, **changes
            )
