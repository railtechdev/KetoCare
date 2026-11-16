export const RATIO_MIN = 1;
export const RATIO_MAX = 5;
export const RATIO_STEP = 0.5;

/**
 * Выше этого соотношения форма назначения предупреждает: международный
 * консенсус по кетогенной диете (Kossoff et al., Epilepsia Open 2018) —
 * «Ratios higher than 4.5:1 are generally not used for more than a few
 * months». Предупреждение, а не запрет: 5 : 1 разрешено и бывает нужно
 * (аудит ядра 15.11.2026, М9). Живёт в ките, а не в ядре: это подсказка
 * интерфейса, расчёт её не читает (ADR-0087).
 *
 * TODO(med): подтвердить у медицинской команды (часть 3 списка вопросов,
 * строка «предупреждение выше 4,5 : 1»).
 */
export const RATIO_LONG_TERM_MAX = 4.5;

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
