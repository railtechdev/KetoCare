"""Whether a new prescription version changes anything.

`prescriptions` is append-only (rule 4), and every saved version notifies the
family that the doctor set a new prescription. A save of the same numbers,
easy to make by pressing "Save" on a form that is always open, added a copy to
the history and sent the family a message about a change that did not happen
(UI audit of 2026-11-18).
"""

from __future__ import annotations

from core.models import Prescription

from ..schemas import PrescriptionCreate

#: Below the precision the form shows (tenths of a gram, a step of 0.5 for the ratio).
_EPSILON = 1e-6


def _text(value: str | None) -> str:
    return (value or "").strip()


def is_unchanged(current: Prescription | None, payload: PrescriptionCreate) -> bool:
    """`payload` repeats `current`, the version in force on its start date.

    Equal values are not enough to refuse: a later version may still take over
    after that date, and the caller checks that (`has_later_start_after`).
    """

    if current is None:
        return False
    return (
        abs(float(current.ratio) - payload.ratio) < _EPSILON
        and int(current.kcal_per_day) == payload.kcal_per_day
        and abs(float(current.protein_g) - payload.protein_g) < _EPSILON
        and abs(float(current.carbs_limit_g) - payload.carbs_limit_g) < _EPSILON
        and int(current.meals_per_day) == payload.meals_per_day
        and current.fluid_ml_per_day == payload.fluid_ml_per_day
        and _text(current.restrictions) == _text(payload.restrictions)
    )
