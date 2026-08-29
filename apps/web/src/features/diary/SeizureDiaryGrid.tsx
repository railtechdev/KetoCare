import { Section } from "@ketocare/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { DiaryLog } from "./diaryApi";
import { DAY_PARTS, buildSeizureGrid, formatCell } from "./seizureGrid";
import type { DictionaryOption } from "./useDiary";

const DATE = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" });

/**
 * Дневник приступов сеткой «день × часть суток» — вид, привычный врачу.
 *
 * Заказчик прислал бумажный дневник KETO-STEP (подготовлен при поддержке
 * Danone Nutricia): коды типов, четыре части суток, итог за день и за период.
 * Хранить приступы так нельзя — клетка «5A» теряет время, длительность и повод,
 * — поэтому сетка собирается из записей `seizure_logs` (ADR-0007).
 *
 * Дни без приступов в сетку не попадают: тридцать пустых строк прятали бы те,
 * ради которых на неё смотрят.
 *
 * Таблица своя, а не `DataTable`: правило П17 канона про таблицы, в которых
 * ищут, сравнивают и открывают строку. Здесь ни того, ни другого, ни третьего —
 * это отчётная матрица с итогами, и сортировка по столбцу «Вечер» её сломала бы.
 */
export function SeizureDiaryGrid({
  logs,
  types,
}: {
  logs: readonly DiaryLog[];
  types: readonly DictionaryOption[];
}) {
  const { t } = useTranslation("diary");
  const grid = useMemo(() => buildSeizureGrid(logs, types), [logs, types]);

  const legend = types
    .filter((type) => type.code)
    .map((type) => `${type.code} — ${type.name}`)
    .join(", ");

  return (
    <Section
      title={t("grid.title")}
      description={grid.rows.length === 0 ? undefined : t("grid.hint")}
    >
      {grid.rows.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">{t("grid.empty")}</p>
      ) : (
        <>
          {/* Широкая таблица прокручивается внутри своего блока, а не тянет
              страницу вбок (правило П17 канона). */}
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t("grid.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t("grid.day")}
                  </th>
                  {DAY_PARTS.map((part) => (
                    <th
                      key={part.key}
                      scope="col"
                      className="p-2 text-left font-semibold"
                    >
                      {t(`grid.parts.${part.key}`)}
                    </th>
                  ))}
                  <th scope="col" className="p-2 text-right font-semibold">
                    {t("grid.total")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.date} className="border-t border-border">
                    <th
                      scope="row"
                      className="p-2 text-left font-normal tabular-nums"
                    >
                      {DATE.format(new Date(`${row.date}T00:00:00`))}
                    </th>
                    {DAY_PARTS.map((part) => (
                      <td
                        key={part.key}
                        className="p-2 tabular-nums whitespace-nowrap"
                      >
                        {formatCell(row.cells[part.key]) || "—"}
                      </td>
                    ))}
                    <td className="p-2 text-right font-semibold tabular-nums">
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <th scope="row" className="p-2 text-left font-semibold">
                    {t("grid.periodTotal")}
                  </th>
                  <td colSpan={DAY_PARTS.length} />
                  <td className="p-2 text-right font-semibold tabular-nums">
                    {grid.total}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {legend !== "" && (
            <p className="m-0 text-xs text-muted-foreground">
              {t("grid.legend", { legend })}
            </p>
          )}
        </>
      )}
    </Section>
  );
}
