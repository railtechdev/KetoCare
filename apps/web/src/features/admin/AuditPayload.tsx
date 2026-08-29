import { useTranslation } from "react-i18next";

import type { AuditEntry } from "./types";

/**
 * Значения `before`/`after` записи журнала — свёрнутым JSON.
 *
 * Развёрнутый JSON в ячейке таблицы делает журнал нечитаемым, а без него
 * непонятно, что именно изменилось, поэтому нагрузка прячется под `details`.
 */
export function AuditPayload({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation("admin");

  // Сервер вырезает нагрузку записей о клинических сущностях: администратор
  // видит факт («кто, что, когда»), но не содержимое (раздел 5.1 ТЗ).
  if (entry.payload_hidden) {
    return (
      <span className="text-sm text-muted-foreground italic">
        {t("audit.payload.hidden")}
      </span>
    );
  }

  if (entry.before === null && entry.after === null) {
    return (
      <span className="text-sm text-muted-foreground">
        {t("audit.payload.none")}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {entry.before !== null && (
        <JsonDetails label={t("audit.payload.before")} value={entry.before} />
      )}
      {entry.after !== null && (
        <JsonDetails label={t("audit.payload.after")} value={entry.after} />
      )}
    </div>
  );
}

export function JsonDetails({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <details className="text-sm">
      <summary className="flex min-h-touch cursor-pointer items-center text-primary">
        {label}
      </summary>
      <pre className="m-0 mt-1 max-h-64 max-w-sm overflow-auto rounded-xl border border-border bg-background p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
