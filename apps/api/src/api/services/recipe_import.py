"""Разбор CSV с рецептами (раздел 15 п. 24 ТЗ: импорт реальной базы).

Форма файла — **строка на ингредиент**, а не строка на рецепт. Причина
практическая: состав у рецептов разной длины, и «строка на рецепт» потребовала
бы либо колонок `product_1..product_20` (и тогда двадцать первый ингредиент
некуда деть), либо списка внутри ячейки (и тогда разбор ячейки становится
собственным форматом со своими кавычками и разделителями). Повторяющиеся строки
читаются и правятся в обычной таблице.

```
title,category,yield_g,servings,instructions,product_name,grams
Омлет,breakfast,150,1,"1. Растопите масло.",Масло сливочное,30
Омлет,,,,,Яйцо куриное,55
```

Шапка рецепта заполняется в первой его строке. В строках состава её оставляют
пустой, а название можно и повторить — так в таблице пишут чаще. Название с
пустой шапкой значит «тот же рецепт»; название с заполненной шапкой во второй
раз — ошибка: два разных рецепта под одним именем.

Продукты сопоставляются **по названию**, а не по идентификатору: файл готовит
человек по своей таблице, а идентификаторов нашей базы он не знает. Сравнение —
по нормализованному имени (регистр и пробелы по краям), тем же правилом, каким
уникальность обеспечена в БД. Не нашлось — ошибка строки, а не создание продукта
на лету: рецепт с выдуманным продуктом посчитается, и число будет неверным.

Разбор отделён от записи, как и у продуктов: сначала отчёт по всем строкам, и
только потом, отдельным решением, запись.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from core.models.enums import RecipeCategory

from ..schemas_recipes import MAX_INGREDIENTS, RecipeIngredientIn, RecipeWrite

REQUIRED_COLUMNS = (
    "title",
    "category",
    "yield_g",
    "servings",
    "instructions",
    "product_name",
    "grams",
)


# Границы берутся у ручного ввода, а не переписываются: второй вход в те же
# таблицы обязан иметь те же пределы. Собственные копии уже однажды разошлись —
# в первой версии этого модуля выход блюда ограничивался двадцатью килограммами
# против ста у формы, а порций было пятьдесят против ста.
def _bound(model: type[BaseModel], field: str, name: str) -> float:
    for meta in model.model_fields[field].metadata:
        value = getattr(meta, name, None)
        if value is not None:
            return float(value)
    raise AssertionError(f"У поля {field} нет ограничения {name}")


GRAMS_MAX = _bound(RecipeIngredientIn, "grams", "le")
YIELD_MAX = _bound(RecipeWrite, "yield_g", "le")
MAX_SERVINGS = int(_bound(RecipeWrite, "servings", "le"))
TITLE_MAX = int(_bound(RecipeWrite, "title", "max_length"))
INSTRUCTIONS_MAX = int(_bound(RecipeWrite, "instructions", "max_length"))


@dataclass(slots=True)
class RowError:
    line: int
    column: str | None
    message: str


@dataclass(slots=True)
class ParsedIngredient:
    line: int
    product_name: str
    grams: float


@dataclass(slots=True)
class ParsedRecipe:
    """Рецепт, собранный из нескольких строк файла."""

    line: int
    title: str
    category: RecipeCategory
    yield_g: float
    servings: int
    instructions: str
    ingredients: list[ParsedIngredient] = field(default_factory=list)


@dataclass(slots=True)
class ImportReport:
    total_rows: int = 0
    recipes: list[ParsedRecipe] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def parse_csv(content: bytes) -> ImportReport:
    """Разобрать файл целиком, собрав ошибки по всем строкам сразу.

    Именно по всем: человек правит выгрузку из чужой таблицы, и отчёт «первая
    ошибка в строке 7» превращает работу в два десятка прогонов.
    """

    report = ImportReport()

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        report.errors.append(RowError(0, None, "Файл не в UTF-8."))
        return report

    reader = csv.DictReader(io.StringIO(text))
    missing = [column for column in REQUIRED_COLUMNS if column not in (reader.fieldnames or [])]
    if missing:
        report.errors.append(RowError(0, None, f"Нет обязательных колонок: {', '.join(missing)}."))
        return report

    by_title: dict[str, ParsedRecipe] = {}
    # Рецепт, к которому относятся строки состава сейчас. `None` значит, что
    # относить их не к чему: шапки ещё не было или она не разобралась.
    current: ParsedRecipe | None = None

    for offset, row in enumerate(reader, start=2):
        report.total_rows += 1
        title = (row.get("title") or "").strip()

        known = by_title.get(_key(title)) if title else None

        if not title:
            # Пустой заголовок — продолжение ТЕКУЩЕГО рецепта, а не последнего
            # разобравшегося. Разница видна там, где шапка не прошла: строки
            # состава прилипали бы к предыдущему, корректному рецепту, и превью
            # показывало бы чужие граммы с посчитанными по ним ккал.
            if current is None:
                report.errors.append(
                    RowError(offset, "title", "Строка состава раньше первого рецепта.")
                )
        elif known is not None and _header_empty(row):
            # Название повторено, а шапка пуста — человек просто продублировал
            # заголовок в строке состава. Так пишут в таблице чаще, чем оставляют
            # ячейку пустой, и считать это ошибкой значило бы спорить с
            # привычкой ради формы файла.
            current = known
        elif known is not None:
            report.errors.append(
                RowError(offset, "title", f"Рецепт «{title}» встречается второй раз.")
            )
            current = None
        else:
            recipe, errors = _header(row, title, offset)
            report.errors.extend(errors)
            if recipe is not None:
                by_title[_key(title)] = recipe
                report.recipes.append(recipe)
            # Шапка не разобралась — состав этого рецепта никуда не приписывается.
            # Иначе он прилип бы к предыдущему, корректному, и в превью показались
            # бы чужие граммы с посчитанными по ним ккал и соотношением.
            current = recipe

        ingredient, errors = _ingredient(row, offset)
        report.errors.extend(errors)
        if ingredient is not None and current is not None:
            current.ingredients.append(ingredient)

    for recipe in report.recipes:
        if len(recipe.ingredients) > MAX_INGREDIENTS:
            # Тот же предел, что у формы: без него импорт заводил бы состав,
            # который через кабинет ввести нельзя.
            report.errors.append(
                RowError(
                    recipe.line,
                    None,
                    f"У рецепта «{recipe.title}» больше {MAX_INGREDIENTS} продуктов.",
                )
            )
        if not recipe.ingredients:
            report.errors.append(
                RowError(recipe.line, None, f"У рецепта «{recipe.title}» нет ни одного продукта.")
            )
        names = [_key(item.product_name) for item in recipe.ingredients]
        for name in {name for name in names if names.count(name) > 1}:
            report.errors.append(
                RowError(
                    recipe.line,
                    "product_name",
                    f"В рецепте «{recipe.title}» продукт повторяется: {name}.",
                )
            )

    return report


#: Ячейки шапки. Пустые все разом — значит, строка описывает только состав.
_HEADER_COLUMNS = ("category", "yield_g", "servings", "instructions")


def _header_empty(row: dict[str, Any]) -> bool:
    return all(not (row.get(column) or "").strip() for column in _HEADER_COLUMNS)


def match_key(name: str) -> str:
    """Ключ сопоставления: регистр и пробелы не различаются.

    Ровно то же правило, каким уникальность имени обеспечена в БД:
    `lower(btrim(name_ru))`. Внутренние пробелы НЕ схлопываются намеренно —
    индекс их тоже не схлопывает, и разбор, находящий «Масло⎵⎵сливочное» там,
    где запрос его не найдёт, дал бы «продукта нет в справочнике» на позиции,
    которую сам же признал совпавшей.

    Публичная: этим же ключом ручка ищет продукты и занятые названия. Два разных
    правила нормализации на одном пути означали бы, что файл разбирается по
    одному, а сопоставляется по другому.
    """

    return name.strip().casefold()


def _key(name: str) -> str:
    return match_key(name)


def _header(
    row: dict[str, Any], title: str, line: int
) -> tuple[ParsedRecipe | None, list[RowError]]:
    errors: list[RowError] = []

    raw_category = (row.get("category") or "").strip().lower()
    try:
        category = RecipeCategory(raw_category)
    except ValueError:
        allowed = ", ".join(item.value for item in RecipeCategory)
        errors.append(
            RowError(line, "category", f"Ожидалось одно из: {allowed}; получено {raw_category!r}.")
        )
        category = RecipeCategory.BREAKFAST

    yield_g = _number(row, "yield_g", line, errors, maximum=YIELD_MAX)
    servings = _number(row, "servings", line, errors, maximum=MAX_SERVINGS)
    if len(title) > TITLE_MAX:
        # Иначе строка проходит превью чисто, а на записи роняет вставку: в
        # таблице `title` — varchar(255), и СУБД ответит пятисоткой вместо
        # понятной ошибки строки.
        errors.append(RowError(line, "title", f"Название длиннее {TITLE_MAX} знаков."))

    instructions = (row.get("instructions") or "").strip()
    if not instructions:
        errors.append(RowError(line, "instructions", "Способ приготовления не заполнен."))
    elif len(instructions) > INSTRUCTIONS_MAX:
        errors.append(
            RowError(
                line, "instructions", f"Способ приготовления длиннее {INSTRUCTIONS_MAX} знаков."
            )
        )

    if errors:
        return None, errors
    return (
        ParsedRecipe(
            line=line,
            title=title,
            category=category,
            yield_g=yield_g or 0.0,
            servings=int(servings or 0),
            instructions=instructions,
        ),
        errors,
    )


def _ingredient(row: dict[str, Any], line: int) -> tuple[ParsedIngredient | None, list[RowError]]:
    errors: list[RowError] = []
    name = (row.get("product_name") or "").strip()
    if not name:
        errors.append(RowError(line, "product_name", "Не указан продукт."))

    grams = _number(row, "grams", line, errors, maximum=GRAMS_MAX)
    if errors or grams is None:
        return None, errors
    return ParsedIngredient(line=line, product_name=name, grams=grams), errors


def _number(
    row: dict[str, Any], column: str, line: int, errors: list[RowError], *, maximum: float
) -> float | None:
    raw = (row.get(column) or "").strip().replace(",", ".")
    if not raw:
        errors.append(RowError(line, column, "Значение не заполнено."))
        return None
    try:
        value = float(raw)
    except ValueError:
        errors.append(RowError(line, column, f"Ожидалось число, получено: {raw!r}."))
        return None
    if value <= 0:
        errors.append(RowError(line, column, "Значение должно быть больше нуля."))
        return None
    if value > maximum:
        errors.append(
            RowError(line, column, f"Значение {value:g} больше допустимого ({maximum:g}).")
        )
        return None
    return value
