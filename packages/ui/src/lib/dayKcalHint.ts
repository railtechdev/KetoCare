/**
 * What the day's calorie bar says under the number: «добавьте ещё N»,
 * «сверх нормы N» or «суточная норма набрана».
 *
 * Words only. The number on the bar, the day's totals and the verdict about the
 * prescription come from the server and are not touched here: this function
 * decides which of three sentences stands under «1 201 из 1 200 ккал».
 *
 * Why a day one kilocalorie off reads as reached. Food is weighed in whole
 * grams (half grams in small meals), so a meal lands a fraction of a
 * kilocalorie off its goal; each meal is shown as a whole number while the day
 * sums the exact values; and the goal of a meal is itself the daily calories
 * divided by the number of meals and rounded to a whole number
 * (`mealTargetsFrom`), which moves the sum of the meal goals by up to half a
 * kilocalorie per meal. A dietitian who fits every meal to its goal still saw
 * «добавьте ещё 1 ккал» or «сверх нормы 1 ккал» on every day and asked whether
 * the calculation was broken (clinic's question of 2026-11-23).
 *
 * The slack is that rounding and nothing more: one kilocalorie per two meals,
 * rounded up — 2 at four meals, 3 at six. It is far inside the calorie
 * tolerance the server judges the day by (5 %), so a day read as reached here
 * is always within tolerance there.
 */
export type DayKcalHint =
  | { kind: "reached" }
  | { kind: "left"; kcal: number }
  | { kind: "over"; kcal: number };

/** Kilocalories of pure rounding in a day of this many meals. */
export function kcalRoundingSlack(
  mealsPerDay: number | null | undefined,
): number {
  if (
    mealsPerDay === null ||
    mealsPerDay === undefined ||
    !Number.isFinite(mealsPerDay) ||
    mealsPerDay <= 0
  ) {
    // The number of meals is unknown: only the rounding of the two numbers
    // on the bar itself is forgiven.
    return 1;
  }
  return Math.ceil(mealsPerDay / 2);
}

export function dayKcalHint(
  kcal: number,
  targetKcal: number,
  mealsPerDay?: number | null,
): DayKcalHint {
  // Whole kilocalories, the way the bar prints both numbers: the sentence
  // must agree with «1 201 из 1 200», not with fractions nobody sees.
  const left = Math.round(targetKcal) - Math.round(kcal);
  if (Math.abs(left) <= kcalRoundingSlack(mealsPerDay)) {
    return { kind: "reached" };
  }
  return left > 0
    ? { kind: "left", kcal: left }
    : { kind: "over", kcal: -left };
}
