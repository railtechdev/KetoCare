"""Медицинские константы расчётного ядра.

Источник — `docs/medical/calculation-engine-spec.md`. Пока файл не создан
медицинской командой, используются значения по умолчанию из раздела 6.2 ТЗ
(`docs/TZ_AI_AGENTS.md`), каждое помечено TODO(med). Соответствующие вопросы
зафиксированы в `docs/medical/OPEN_QUESTIONS.md`. Менять значения здесь без
ссылки на новую версию медицинской спецификации нельзя (правило 2, CLAUDE.md).
"""

# TODO(med): подтвердить у медицинской команды — энергетическая ценность нутриентов, ккал/г
KCAL_PER_G_FAT = 9.0
KCAL_PER_G_PROTEIN = 4.0
KCAL_PER_G_CARBS = 4.0

# Учёт углеводов — ответ клиники от 09.09.2026 (вопросы 2, 3 и 6 в
# `docs/medical/OPEN_QUESTIONS.md`), и он разный для двух величин:
#
#   • КЕТОСООТНОШЕНИЕ считается по ЧИСТЫМ углеводам, за вычетом клетчатки
#     («считать „чистые“ углеводы, с вычетом клетчатки»; «клетчатка в расчёты не
#     входит, то есть она не входит в чистые углеводы»);
#   • ЛИМИТ УГЛЕВОДОВ из назначения применяется ко ВСЕМ углеводам
#     («учитываются все углеводы, и при сочетании продуктов учитывается их сумма»).
#
# Это не переключатель: клиника назвала правило, а не выбор, и прежний флаг
# `Targets.net_carbs` убран — иначе в контракте осталось бы состояние, которого
# в предметной области нет.
#
# Клетчатка вычитается ПО КАЖДОМУ продукту и не уходит в минус: у продукта, где
# клетчатки записано больше углеводов, вычитание дало бы отрицательный вклад в
# знаменатель и завысило соотношение. Такой продукт импорт отвергает, но ядро не
# полагается на чужую проверку.

# TODO(med): подтвердить у медицинской команды — допуск соответствия по кетосоотношению,
# в абсолютных единицах R (напр. R=4.0 ± 0.15 считается соответствующим назначению)
RATIO_TOLERANCE = 0.15

# TODO(med): подтвердить у медицинской команды — допуск по калорийности приёма, доля от цели
KCAL_TOLERANCE_FRACTION = 0.05

# TODO(med): подтвердить у медицинской команды — округление итоговых масс ингредиентов, г
GRAM_ROUNDING = 1

# TODO(med): подтвердить у медицинской команды — минимальная реалистичная масса ингредиента, г.
# Используется как порог пост-обработки solve(): после округления массы ниже порога
# считаются практически нулевыми (ингредиент исключается из результата).
MIN_INGREDIENT_GRAMS = 2.0

# How far the protein and the net carbs of a dish may each be from the meal's
# goal and still count as matching it, grams. One gram of either is 4 kcal, and
# "within 4 kcal of the goal" is the precision rule of KetoDietCalculator, the
# tool the clinic's dietitians fit meals with today (docs/AUDIT_KDC_GAP_2026-11.md,
# G16).
# Confirmed by the clinic's dietitian on 2026-11-16 (question 58): "0,5–1 г разницы
# играть не будет, главное, чтобы соотношение не менялось".
MEAL_MACRO_TOLERANCE_G = 1.0

# Верхняя граница массы одного ингредиента по умолчанию для solve(), г.
# Не медицинская константа — техническое ограничение LP-задачи (конечная область допустимых
# решений для HiGHS); не требует TODO(med) и не публикуется в API как клинический параметр.
DEFAULT_MAX_INGREDIENT_GRAMS = 5000.0

# 0.2.0 — добавлена max_non_fat_grams(); поведение verify/solve/scale не изменилось,
# поэтому результаты, сохранённые с 0.1.0, остаются действительными.
# 0.3.0 — solve() чинит округление масс: LP решал точно, но округление до грамма
# выводило соотношение за допуск на небольших приёмах пищи (property-тест нашёл
# 4:1 при 200 ккал → 3.85). Раздел 6.4 ТЗ требует, чтобы verify(solve(x)) был в
# допусках, то есть прежнее поведение нарушало контракт. Minor, а не major:
# меняются ТОЛЬКО те результаты, которые раньше были за допуском, то есть
# ошибочные; уже укладывавшиеся в допуск расчёты не затронуты.
# 0.4.0 — verify() отдаёт вклад каждой позиции (kcal и макронутриенты на её
# массу) в `ItemAmount`. Итоги блюда считаются как сумма этих вкладов той же
# арифметикой, что и раньше, поэтому результаты, сохранённые с 0.3.0, остаются
# действительными. Minor: новые поля контракта, математика итогов не изменилась.
# 1.0.0 — кетосоотношение считается по ЧИСТЫМ углеводам (ответ клиники от
# 09.09.2026, вопросы 2 и 6). Major: меняются результаты УЖЕ ПОСЧИТАННОГО —
# любое блюдо, где у продуктов есть клетчатка, получает более высокое
# соотношение, и вердикт «в допуске» у части блюд меняется на противоположный.
# Лимит углеводов из назначения остался по общим углеводам (вопрос 3), то есть
# две величины считаются по-разному намеренно.
# 1.1.0 — чистые углеводы, неотличимые от ошибки вычитания, считаются нулём:
# у продукта, где клетчатка составляет почти все углеводы, разность вырождается
# в мусор округления, и соотношение зависело от масштаба масс (2.25e14 на
# десяти граммах против 3.38e14 на тридцати). Плюс бесконечность больше не
# уходит наружу. Minor, а не major: сохранённые расчёты не меняются НИ ОДИН —
# перебор 349888 пар, представимых в базе (продукты Numeric(6,2), граммы
# Numeric(7,1)), не дал ни одного попадания в полосу отказа, а самый тесный
# реальный случай имеет запас в сто пятьдесят тысяч раз. Разбор — ADR-0037.
# 1.2.0 — `within_tolerance()` отвечает о соотношении ТРЕМЯ состояниями:
# `None` означает «сказать нечего» (у блюда нет соотношения), и это больше не
# схлопывается в «не соответствует». Minor: числа те же, меняется форма ответа —
# у дня без соотношения вместо ложного «вне допуска» приходит «не определено».
# 1.4.0 — `energy_requirement()` gives the daily calorie range from age and weight
# (Yonsei table, question 56). Minor: a new function, nothing else changes.
# 1.3.0 — `ItemAmount` carries the net carbs of its position, and `meal_macro_goal()`
# gives the grams one meal should contain. Minor: new contract fields and a new
# function, the results of verify() and solve() do not change.
# 1.5.0 — `protein_requirement()` gives the daily protein target from weight
# (1 g per kg, clinic's answer of 2026-11-11). Minor: a new function.
# 1.6.0 — `fluid_requirement()` gives the daily fluid volume from weight by the
# Holliday-Segar method (question 53, ADR-0069). Minor: a new function.
# 1.7.0 — `dietary_unit_kcal()` gives the energy of one dietary unit at a ratio
# (R g fat + 1 g protein with net carbs), the way the clinic's Yonsei slide
# explains the calculation. Minor: a new function, nothing else changes.
# 1.8.0 — solve() repairs whole-gram rounding when it breaks the calorie
# corridor, the protein minimum or the carbs limit, not only the ratio; a dish
# still below the protein minimum or above the carbs limit after repair is an
# InfeasibleError with the reason instead of a silent result (calculation audit
# of 2026-11-13). Minor, as 0.3.0: only results that broke their own targets
# change; verify() and every stored number stay the same.
# 1.9.0 — solve() aims at the meal's protein and net carbs when `Targets` carries
# them (`protein_g`, `net_carbs_g`), stays near the entered masses
# (`near_grams`), and of the whole-gram compositions near the exact solution it
# returns the closest one instead of the first inside the tolerances;
# `macro_fit()` says how far a dish is from that split, and `meal_macro_goal()`
# keeps the carbs goal under the day's limit. Before this the solver held only
# the ratio and the calories and split protein against carbs wherever the
# linear programme landed: a dietitian got 8.1 g of protein and 0.8 g of carbs
# against a goal of 4.6 and 4.3 (complaint of 2026-11-15, ADR-0083). Minor:
# verify() and every stored number stay the same. solve() without the new
# fields holds the same hard constraints, but it is not the same answer: the
# closest whole-gram dish replaces the first allowed one, and the vertex the
# programme lands on may differ.
# 1.10.0 — solve() finds the dish that exists and keeps the dish that is on
# target (independent audit of 2026-11-15, docs/AUDIT_ENGINE_2026-11.md, A1, A2
# and A7). The ratio falls back from an equality to a band inside its tolerance
# when the equality cannot be met (pinned masses refused a dish that was within
# both tolerances in one request out of ten); pinned products are no longer
# moved by the whole-gram search; a gram-by-gram descent over every free product
# ends the search, and `refine()` starts from the entered dish with the same
# moves, so solving one's own answer changes nothing (it moved 54 % of the
# time); products are sorted before solving, so the answer does not depend on
# their order in the request. verify() refuses negative masses. `meal_kcal()`
# is the one place the calories of a meal are rounded. Minor: verify() and
# every stored number stay the same; solve() holds the same hard constraints.
# 1.11.0 — `protein_requirement()` takes the age: 1.5 g per kg under one year,
# 1.2 g per kg from one to two, 1 g per kg from two (question 59, ADR-0085).
# Minor: a hint for the prescription form; verify(), solve() and every stored
# number stay the same, and nothing changes for children from two years.
ENGINE_VERSION = "1.11.0"


# Daily calories per kilogram on the ketogenic diet by age: Yonsei University,
# "Nutritional requirement for KD", sent by the clinic's dietitian on 2026-10-27
# and 2026-11-11 with the instruction to use it as the basis of the calculation.
# Rows: (upper bound of age in whole years, exclusive; kcal/kg min; kcal/kg max).
# The slide also says "initial prescription 85-95% of daily requirement"; the
# clinic confirmed on 2026-11-11 that the table itself is the prescription
# range, without a further 85-95% cut (question 56, closed).
ENERGY_KCAL_PER_KG_BY_AGE: tuple[tuple[float, float, float], ...] = (
    (1, 75.0, 85.0),
    (4, 70.0, 75.0),
    (7, 65.0, 68.0),
    (11, 55.0, 60.0),
    (float("inf"), 30.0, 40.0),
)


# Daily protein target on the ketogenic diet by age, grams per kilogram of body
# weight. Rows: (upper bound of age in whole years, exclusive; g per kg).
# From two years: 1 g per kg, confirmed by the clinic on 2026-11-11 ("верно,
# правило 1 г на кг"), as in KDC, where protein is derived rather than entered.
# Under two years the international guidance asks for more: van der Louw E. et al.
# "Ketogenic diet guidelines for infants with refractory epilepsy", Eur J Paediatr
# Neurol 2016;20:798-809 (1.1-2.0 g/kg by month of the first year), and Ruiz
# Herrero J. et al., Spanish recommendations 2020 (1.5 g/kg under one year). The
# rows below were proposed after the engine audit of 2026-11-15 and agreed by the
# clinic's dietitian on 2026-11-16 (question 59): "Абсолютно согласна детям до
# 2-х лет увеличить диапазон белков".
PROTEIN_G_PER_KG_BY_AGE: tuple[tuple[float, float], ...] = (
    (1, 1.5),
    (2, 1.2),
    (float("inf"), 1.0),
)


# Daily fluid requirement by weight, Holliday-Segar method: Holliday MA, Segar WE.
# "The maintenance need for water in parenteral fluid therapy". Pediatrics
# 1957;19:823-832. 100 mL/kg for the first 10 kg, plus 50 mL/kg for each kg from
# 10 to 20, plus 20 mL/kg for each kg above 20. KDC shows the same number as
# "Recommended Fluids by Holliday-Segar" (docs/AUDIT_KDC.md, K1); the owner chose
# the international standard without waiting for the clinic (question 53, ADR-0069).
# Rows: (upper bound of the band in kg, exclusive of the next band; mL per kg).
# TODO(med): подтвердить у медицинской команды (вопрос 53, Н7)
FLUID_ML_PER_KG_BANDS: tuple[tuple[float, float], ...] = (
    (10.0, 100.0),
    (20.0, 50.0),
    (float("inf"), 20.0),
)
