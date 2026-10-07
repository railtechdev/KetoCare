import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export interface FormErrorSummaryItem {
  /** id поля, к которому ведёт строка сводки */
  fieldId: string;
  /** Тот же текст, что показан под полем: расхождение читается как две разные ошибки */
  message: string;
}

/**
 * Строки сводки из пар «id поля → текст под полем».
 *
 * До первой отправки сводки нет вовсе (ошибка живёт под полем, с которого
 * ушли); после — остаются только поля, у которых сообщение есть. Порядок пар
 * повторяет порядок полей формы, и сводка читается сверху вниз так же, как
 * форма.
 *
 * Сообщение передаётся то же, что и под полем, — одним выражением, а не
 * второй формулировкой: иначе сводка говорит об ошибке, которой под полем нет.
 */
export function errorSummaryItems(
  submitCount: number,
  entries: readonly (readonly [fieldId: string, message: unknown])[],
): FormErrorSummaryItem[] {
  if (submitCount === 0) return [];
  return entries.flatMap(([fieldId, message]) =>
    typeof message === "string" && message !== "" ? [{ fieldId, message }] : [],
  );
}

/**
 * Сводка ошибок над формой (правило П8 UI-канона).
 *
 * Появляется только после неудачной отправки и забирает фокус: без этого
 * пользователь, нажавший «Сохранить» с клавиатуры, остаётся у кнопки внизу и об
 * ошибке узнаёт, только если сам вернётся к полям. Каждая строка — ссылка в
 * своё поле, порядок строк повторяет порядок полей формы.
 *
 * Сообщения приходят готовыми и совпадают с текстом под полем: сводка,
 * формулирующая ту же ошибку иначе, заставляет искать второе несуществующее
 * место.
 *
 * Живёт в общих местах, а не в `features/admin`, где появился: правило П8
 * требует сводку от КАЖДОЙ формы, а не от форм одного раздела. Пока он лежал
 * внутри админки, формы врача её не имели — и врач, отправивший назначение с
 * ошибкой, оставался у кнопки внизу без единого указания, что не так.
 */
export function FormErrorSummary({
  title,
  items,
  focusKey,
}: {
  /** Заголовок сводки; по умолчанию общий «Проверьте заполнение полей» */
  title?: string;
  items: readonly FormErrorSummaryItem[];
  /** Счётчик отправок: по его изменению сводка переносит на себя фокус */
  focusKey: number;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const shown = items.length > 0;

  useEffect(() => {
    if (shown) container.current?.focus();
  }, [focusKey, shown]);

  if (!shown) return null;

  return (
    <div
      ref={container}
      role="alert"
      tabIndex={-1}
      className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4"
    >
      <p className="m-0 font-semibold text-foreground">
        {title ?? t("form.errorSummary")}
      </p>
      <ul className="m-0 mt-field flex list-none flex-col gap-field p-0">
        {items.map((item) => (
          <li key={item.fieldId}>
            <a
              href={`#${item.fieldId}`}
              className="text-sm text-destructive underline underline-offset-2"
              onClick={(event) => {
                // Переход по якорю сам фокус в поле не переносит: без этого
                // ссылка приводит к нужному месту экрана, но исправлять
                // приходится мышью.
                event.preventDefault();
                document.getElementById(item.fieldId)?.focus();
              }}
            >
              {item.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
