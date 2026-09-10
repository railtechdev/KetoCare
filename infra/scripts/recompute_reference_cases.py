"""Пересчёт ожидаемых значений в предварительных эталонах расчётного ядра.

**Зачем.** Клиника ответила (09.09.2026, вопросы 2, 3 и 6 в
`docs/medical/OPEN_QUESTIONS.md`), что кетосоотношение считается по ЧИСТЫМ
углеводам. Это меняет результат каждого расчёта, где у продуктов есть клетчатка,
— то есть ожидаемые значения в эталонах перестали быть верными.

**Почему скрипт, а не правка руками.** Эталонов 35, пересчёта требуют 15, и в
каждом надо заменить числа, посчитанные ядром, — рука здесь ошибётся вернее
машины. Числа берутся из самого ядра: скрипт ничего не вычисляет сам.

**Почему запускает человек.** `docs/medical/` защищён хуком: спецификации и
эталоны меняет медицинская команда (правило 2 `CLAUDE.md`). Скрипт трогает
только случаи с пометкой `provisional: true` — наши собственные предварительные
ожидания, не подписанные клиникой, — и отказывается трогать остальные.

Запуск:

    uv run python infra/scripts/recompute_reference_cases.py           # показать, что изменится
    uv run python infra/scripts/recompute_reference_cases.py --apply   # записать
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Any

import yaml

from keto_engine import ENGINE_VERSION, InfeasibleError, Ingredient, Targets, scale, solve, verify

CASES_DIR = pathlib.Path(__file__).resolve().parents[2] / "docs" / "medical" / "reference-cases"


def _ingredients(raw: list[dict[str, Any]]) -> dict[str, Ingredient]:
    return {
        item["product_id"]: Ingredient(
            product_id=item["product_id"],
            kcal=item["kcal"],
            fat=item["fat"],
            protein=item["protein"],
            carbs=item["carbs"],
            fiber=item.get("fiber", 0.0),
        )
        for item in raw
    }


def _targets(raw: dict[str, Any]) -> Targets:
    bounds = raw.get("per_ingredient_bounds")
    if bounds is not None:
        bounds = {pid: tuple(value) for pid, value in bounds.items()}
    return Targets(
        ratio=raw["ratio"],
        kcal=raw["kcal"],
        protein_min_g=raw.get("protein_min_g"),
        carbs_max_g=raw.get("carbs_max_g"),
        per_ingredient_bounds=bounds,
    )


def _dish_expected(dish: Any) -> dict[str, Any]:
    return {
        "kcal": round(dish.kcal, 6),
        "fat_g": round(dish.fat_g, 6),
        "protein_g": round(dish.protein_g, 6),
        "carbs_g": round(dish.carbs_g, 6),
        "fiber_g": round(dish.fiber_g, 6),
        "ratio": None if dish.ratio is None else round(dish.ratio, 6),
    }


def drop_removed_switch(case: dict[str, Any]) -> bool:
    """Убирает из целей ключ `net_carbs`, которого больше нет в контракте.

    Переключателя не существует: соотношение считается по чистым углеводам
    всегда. Оставленный в эталоне ключ описывал бы выбор, которого нет, и тест
    на нём падает намеренно.
    """

    targets = case.get("input", {}).get("targets")
    if isinstance(targets, dict) and "net_carbs" in targets:
        del targets["net_carbs"]
        return True
    return False


def recompute(case: dict[str, Any]) -> dict[str, Any] | None:
    """Новые ожидаемые значения или `None`, если случай пересчёта не требует."""

    operation = case["operation"]
    raw_input = case["input"]
    expected = dict(case.get("expected") or {})

    # Заменяются только те ключи, которые в эталоне уже есть: медицинский файл
    # не должен обрастать полями от того, что по нему прогнали скрипт.
    def only_present(fresh: dict[str, Any]) -> dict[str, Any]:
        return {**expected, **{k: v for k, v in fresh.items() if k in expected}}

    if operation == "verify":
        ingredients = _ingredients(raw_input["ingredients"])
        items = [(ingredients[i["product_id"]], i["grams"]) for i in raw_input["items"]]
        return only_present(_dish_expected(verify(items)))

    if operation == "scale":
        ingredients = _ingredients(raw_input["ingredients"])
        items = [(ingredients[i["product_id"]], i["grams"]) for i in raw_input["recipe_items"]]
        return only_present(_dish_expected(scale(verify(items), raw_input["factor"])))

    if operation == "solve":
        # У случаев подбора ожидание одно — разрешима задача или нет; сами массы
        # тест проверяет собственным пересчётом. Значит, менять здесь нечего,
        # кроме случая, когда разрешимость изменилась: об этом надо сказать
        # громко, а не переписать молча.
        ingredients = _ingredients(raw_input["ingredients"])
        try:
            solve(list(ingredients.values()), _targets(raw_input["targets"]))
            infeasible_now = False
        except InfeasibleError:
            infeasible_now = True
        if bool(expected.get("infeasible")) != infeasible_now:
            raise SystemExit(
                f"ВНИМАНИЕ: у эталона «{case['name']}» изменилась разрешимость "
                f"({expected.get('infeasible')} → {infeasible_now}). Это не пересчёт "
                "чисел, а другое клиническое утверждение — решать человеку."
            )
        return None

    return None


#: Заметки, которые описывали ПРЕЖНЕЕ правило и после пересчёта стали неправдой.
#: Дописать к такой заметке новую — оставить файл, спорящий сам с собой; поэтому
#: они заменяются целиком, и каждая замена названа здесь явным списком, а не
#: угадывается по подстроке.
_STALE_NOTES = {
    "solve_feasible_net_carbs_true_with_fiber": (
        "клетчатка авокадо не входит в знаменатель соотношения: оно считается по чистым "
        "углеводам (ответ клиники 09.09.2026, вопросы 2 и 6). Прежде это включалось "
        "флагом net_carbs, которого больше нет"
    ),
    "verify_high_fiber_avocado_almonds": (
        "высокая клетчатка (авокадо + миндаль): общие углеводы включают её, а соотношение "
        "считается по чистым — на этом случае разница видна лучше всего"
    ),
}


def _note_for(case: dict[str, Any], *, recomputed: bool) -> str:
    """Заметка эталона после пересчёта.

    Пометка о версии ядра ставится ТОЛЬКО тем случаям, у которых числа
    действительно изменились: у нулевых по углеводам блюд правило не изменило
    ничего, и метка «пересчитано» была бы там неправдой.
    """

    replacement = _STALE_NOTES.get(case["name"])
    if replacement is not None:
        return replacement

    note = case.get("note", "")
    if not recomputed:
        return note
    mark = f"пересчитано под ENGINE_VERSION {ENGINE_VERSION}: соотношение по чистым углеводам"
    if mark in note:
        return note
    return f"{note}; {mark}" if note else mark


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="записать изменения в файлы")
    args = parser.parse_args()

    changed: list[str] = []
    skipped: list[str] = []

    for path in sorted(CASES_DIR.glob("*.yaml")):
        case = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not case.get("provisional"):
            skipped.append(f"{path.name}: не provisional — не трогаем")
            continue

        switch_dropped = drop_removed_switch(case)
        updated = recompute(case)
        values_changed = updated is not None and updated != case.get("expected")
        # Заметка проверяется отдельно от чисел: она может врать и при верных
        # числах — так и вышло, когда первый прогон дописал новое правило к
        # старому вместо замены, и файл стал спорить сам с собой.
        new_note = _note_for(case, recomputed=values_changed or switch_dropped)
        note_stale = new_note != case.get("note", "")

        if not (values_changed or switch_dropped or note_stale):
            continue
        if updated is None:
            updated = case.get("expected") or {}

        before = case.get("expected") or {}
        diffs = [
            f"    {key}: {before.get(key)} → {value}"
            for key, value in updated.items()
            if before.get(key) != value
        ]
        if switch_dropped:
            diffs.insert(0, "    убран ключ net_carbs: переключателя больше нет")
        if note_stale:
            diffs.append(f"    заметка: {new_note}")
        changed.append(path.name + "\n" + "\n".join(diffs))

        if args.apply:
            case["expected"] = updated
            case["note"] = new_note
            path.write_text(
                yaml.safe_dump(case, allow_unicode=True, sort_keys=False, width=88),
                encoding="utf-8",
            )

    for line in skipped:
        print(line)
    print(f"\nЭталонов к пересчёту: {len(changed)} (версия ядра {ENGINE_VERSION})\n")
    for line in changed:
        print(line)
    if changed and not args.apply:
        print("\nНичего не записано. Повторите с --apply, если числа верны.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
