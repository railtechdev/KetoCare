"""Вердикт о соответствии дня назначению — один на сводку и на меню.

Жил в `services/overview` и судил только сегодняшний день; меню на вчера и
завтра экраны сверяли с сегодняшним назначением сами (аудит расчётов
13.11.2026). Теперь вердикт любого дня считает сервер — этой функцией, по
назначению ЭТОГО дня (`prescriptions_repo.get_active_on`).
"""

from __future__ import annotations

from core.models import Prescription
from keto_engine import DishResult, Targets, within_tolerance

from ..schemas import DishComputed
from ..schemas_overview import DayTolerance, ToleranceGap
from .engine_version import comparable_to_current


def day_tolerance(
    totals: DishComputed, prescription: Prescription | None, engine_version: str | None
) -> tuple[DayTolerance | None, ToleranceGap | None]:
    """Вердикт о соответствии дня назначению либо причина, по которой его нет.

    Возвращается пара, а не один `None` на оба случая: причин молчать две, и на
    экране они означают разное. Пока причина была одна, отсутствие вердикта
    из-за смены версии ядра кабинет объяснял семье как «активного назначения
    нет» — при живом назначении.
    """

    if prescription is None:
        return None, ToleranceGap.NO_PRESCRIPTION

    # Версия могла не записаться вовсе: колонка это допускает. Сверять нечего,
    # но и назвать день «посчитанным прежней версией» нельзя — какой именно,
    # неизвестно.
    if engine_version is None:
        return None, ToleranceGap.ENGINE_UNKNOWN

    # День, посчитанный ядром другой ОСНОВНОЙ версии, вердикта не получает.
    #
    # Итоги дня хранятся снимком (ADR-0016) и не пересчитываются, а major
    # означает, что изменились сами числа: с 1.0.0 соотношение считается по
    # чистым углеводам (ADR-0030). Сказать «в допуске» про соотношение,
    # посчитанное прежним правилом, — значит выдать старое утверждение за
    # сегодняшнее; экран умеет показывать день без вердикта.
    #
    # Сравниваются ТОЛЬКО старшие части: minor и patch по семантике версий
    # чисел не меняют, и на них вердикт сниматься не должен — иначе следующий
    # безобидный бамп молча оставит без вердикта все сохранённые дни.
    if not comparable_to_current(engine_version):
        return None, ToleranceGap.ENGINE_CHANGED

    # DishResult собирается из сохранённых итогов только ради вызова
    # `within_tolerance`: сам состав дня (items) в допусках не участвует.
    #
    # Чистые углеводы восстанавливаются из сохранённых общих и клетчатки — по
    # блюду целиком, тогда как ядро вычитает по каждому продукту. На дне, где у
    # какого-то продукта клетчатки больше углеводов, числа разойдутся; точнее из
    # снимка не восстановить, там лежат только итоги. В допуски поле не входит
    # вовсе — там сравнивается уже посчитанное соотношение.
    dish = DishResult(
        items=(),
        kcal=totals.kcal,
        fat_g=totals.fat,
        protein_g=totals.protein,
        carbs_g=totals.carbs,
        fiber_g=totals.fiber,
        net_carbs_g=max(totals.carbs - totals.fiber, 0.0),
        ratio=totals.ratio,
    )
    targets = Targets(ratio=float(prescription.ratio), kcal=float(prescription.kcal_per_day))
    ratio_ok, kcal_ok = within_tolerance(dish, targets)
    # Лимит углеводов — по ОБЩИМ углеводам (ответ клиники на вопрос 3), так же,
    # как его держит решатель ядра (`carbs_max_g`).
    carbs_ok = totals.carbs <= float(prescription.carbs_limit_g) + 1e-9
    return (
        DayTolerance(
            ratio_within_tolerance=ratio_ok,
            kcal_within_tolerance=kcal_ok,
            carbs_within_limit=carbs_ok,
        ),
        None,
    )
