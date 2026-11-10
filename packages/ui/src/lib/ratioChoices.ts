export const RATIO_MIN = 1;
export const RATIO_MAX = 5;
export const RATIO_STEP = 0.5;

/**
 * Кетосоотношения, из которых выбирают: врач мыслит «4 : 1», а не числом 4.
 *
 * Одни и те же значения в назначении и в калькуляторах кабинета и Mini App.
 * Порядок от высокого к низкому: терапию начинают с более жёсткого соотношения.
 * Шаг 0,25, как в KetoDietCalculator, остаётся вопросом K7 (`docs/AUDIT_KDC.md`).
 */
export const RATIO_CHOICES: readonly number[] = Array.from(
  { length: Math.round((RATIO_MAX - RATIO_MIN) / RATIO_STEP) + 1 },
  (_, index) => RATIO_MAX - index * RATIO_STEP,
);
