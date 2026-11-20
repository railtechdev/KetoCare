/**
 * Шаги приготовления из текста рецепта: строка — шаг.
 *
 * Диетолог часто нумерует шаги сама («1. Взбить…», «2) Добавить…», «- Жарить»),
 * а лист нумерует их тоже — выходило «1. 1. Взбить». Своя разметка строки
 * снимается, номер ставит лист. Число в начале шага без точки или скобки
 * («2 яйца взбить», «1,5 часа варить») — часть текста и остаётся.
 */
export function cookingSteps(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^(?:\d{1,2}[.)]|[-–—•*])\s+/, "")
        .trim(),
    )
    .filter((line) => line !== "");
}

/** Те же шаги текстом для Word: один шаг — абзац без номера, несколько — с номерами. */
export function numberedSteps(text: string | null | undefined): string {
  const steps = cookingSteps(text);
  return steps.length === 1
    ? (steps[0] ?? "")
    : steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
}
