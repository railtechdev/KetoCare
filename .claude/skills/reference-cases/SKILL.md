---
name: reference-cases
description: Эталонные расчёты docs/medical/reference-cases — формат yaml, флаг provisional, как добавляются и когда могут меняться, как подключаются к pytest. Использовать при работе с эталонными тестами keto_engine.
---

# Эталонные расчёты

Каталог: `docs/medical/reference-cases/*.yaml`. Загрузчик и семантика —
`packages/keto_engine/tests/test_reference_cases.py` (единственный источник правды
о полях; при расхождении с этим файлом прав тест, а не скилл).

## Общие поля

```yaml
name: solve_feasible_4to1_basic   # совпадает с именем файла без .yaml
provisional: true                 # обязательно true, пока эталон не утверждён мед. командой
operation: verify | solve | scale
note: "человекочитаемое пояснение / показанный ручной расчёт"
input: {...}                      # зависит от operation
expected: {...}                   # зависит от operation
tolerance:
  abs: 1.0e-06                    # абсолютный допуск, по умолчанию 1e-6
```

Ингредиенты везде задаются на 100 г: `product_id, kcal, fat, protein, carbs, fiber`.

## verify

```yaml
input:
  ingredients: [{product_id: olive_oil, kcal: 884, fat: 100.0, protein: 0.0, carbs: 0.0, fiber: 0.0}]
  items:
  - {product_id: olive_oil, grams: 30.0}
expected: {kcal: ..., fat_g: ..., protein_g: ..., carbs_g: ..., fiber_g: ..., ratio: ...}
```
`ratio: null` — если белки+углеводы равны нулю. Все пять макро-полей обязательны.

## scale

Как verify, но `recipe_items` вместо `items` плюс `factor`; рецепт собирается через
`verify(recipe_items)`, затем масштабируется. `expected` — те же поля блюда.

## solve

```yaml
input:
  ingredients: [...]
  targets: {ratio: 4.0, kcal: 400, protein_min_g: 6, carbs_max_g: 3,
            per_ingredient_bounds: {butter: [0, 60]}, net_carbs: false}
expected:
  infeasible: false        # true → тест ждёт InfeasibleError
  reason_contains: "жировой компонент"   # только при infeasible: true, подстрока причины
```
При `infeasible: false` эталон не фиксирует конкретные массы: тест сам пересчитывает
результат и проверяет инварианты (R в ±RATIO_TOLERANCE, kcal в ±KCAL_TOLERANCE_FRACTION,
границы protein_min/carbs_max/per_ingredient_bounds с допуском на округление).

## Правила

- Тест параметризуется по всем файлам каталога; `skip`/`xfail` на эталоны запрещён.
  Загрузчик требует минимум 30 сценариев и `provisional: true` у каждого.
- Агент может только ДОБАВЛЯТЬ provisional-эталоны, посчитанные вручную по формулам
  ТЗ §6.2 (расчёт показан в `note`), и только по явной просьбе человека —
  каталог защищён хуком, файл создаст человек.
- Менять/удалять существующие эталоны агенту нельзя; замена provisional → медицинский
  делается человеком по утверждённой спецификации.
- Минимальный обязательный набор: соотношения 4:1, 3:1, 2.5:1, 2:1; infeasible-случаи
  с проверкой текста причины; нулевые углеводы; продукты с клетчаткой;
  scale с нарушением границ; граничная низкая калорийность.
- Эталон упал → чини код ядра, не тест и не yaml.
