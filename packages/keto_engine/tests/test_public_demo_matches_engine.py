"""Демонстрационный калькулятор лендинга обязан считать как ядро.

**Почему этот тест живёт здесь.** Ядро — источник правила расчёта, а лендинг —
единственное место в репозитории, где формула повторена второй раз: страница
собирается статически, ядра в браузере нет. Комментарий в `keto.ts` обещал
«меняется там — меняется и здесь», и обещание не сработало: ADR-0030 перевёл
соотношение на чистые углеводы, страница осталась на общих и на своих же
граммовках показывала «в допуске» ровно там, где продукт сказал бы «выше
назначения». Публичная страница про клинический расчёт спорила с расчётом.

Числа лежат в общем файле, который читают обе стороны, — поэтому расхождение
теперь ловится здесь, а не посетителем.

Тест не сверяет реализацию на TypeScript построчно: он проверяет утверждение,
которое страница делает вслух, — что граммовки по умолчанию попадают в
назначение 3,5 : 1. Если правило расчёта изменится, попадать они перестанут.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from keto_engine import Ingredient, verify
from keto_engine.constants import RATIO_TOLERANCE

_DEMO = (
    pathlib.Path(__file__).resolve().parents[3]
    / "packages"
    / "landing"
    / "src"
    / "lib"
    / "demo-dish.json"
)


@pytest.fixture(scope="module")
def demo() -> dict:
    assert _DEMO.exists(), (
        f"нет файла {_DEMO}: числа демо-калькулятора лендинга должны лежать в "
        "общем файле, иначе страница снова разойдётся с ядром молча"
    )
    return json.loads(_DEMO.read_text(encoding="utf-8"))


def _dish(demo: dict):
    items = [
        (
            Ingredient(
                product_id=raw["id"],
                kcal=raw["kcal"],
                fat=raw["fat"],
                protein=raw["protein"],
                carbs=raw["carbs"],
                fiber=raw["fiber"],
            ),
            float(raw["initial"]),
        )
        for raw in demo["ingredients"]
    ]
    return verify(items)


def test_default_grams_hit_the_advertised_ratio(demo: dict) -> None:
    """Заголовок обещает «соберите завтрак под назначение 3,5 : 1».

    Открывать раздел красной надписью «выше назначения» — значит показывать
    посетителю поломку вместо примера. Проверяется настоящим ядром, поэтому
    подогнать страницу под себя нельзя.
    """

    dish = _dish(demo)

    assert dish.ratio is not None
    assert abs(dish.ratio - demo["target_ratio"]) <= RATIO_TOLERANCE, (
        f"граммовки по умолчанию дают {dish.ratio:.3f} : 1 при цели "
        f"{demo['target_ratio']} ± {RATIO_TOLERANCE}. Правило расчёта изменилось — "
        "подберите граммовки заново в packages/landing/src/lib/demo-dish.json"
    )


def test_demo_dish_actually_contains_fibre(demo: dict) -> None:
    """Без клетчатки случай ничего не различает.

    Если из демо-набора однажды уберут брокколи, тест выше пройдёт при любом
    правиле — и снова перестанет что-либо защищать.
    """

    dish = _dish(demo)

    assert dish.fiber_g > 0.0
    assert dish.net_carbs_g < dish.carbs_g
