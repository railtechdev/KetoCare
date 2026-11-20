import { EmptyState, Section } from "@ketocare/ui";

import { PrintButton } from "../../components/PrintButton";
import { PrintedSheets } from "../../components/print/PrintedSheets";
import { useDocumentFrame } from "../letterhead/useDocumentFrame";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { DiaryLog } from "./diaryApi";
import { DAY_PARTS, buildSeizureGrid, formatCell } from "./seizureGrid";
import type { DictionaryOption } from "./useDiary";

const DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
});
const FULL_DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

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
  complete = true,
  patientName,
  period,
  audience = "staff",
}: {
  logs: readonly DiaryLog[];
  types: readonly DictionaryOption[];
  /** Ребёнок на листе печати; без него печати нет (ADR-0092). */
  patientName?: string;
  /**
   * Выбранный период — на листе печати: «итог за период» без названного
   * периода на бумаге ничего не сообщает. Без него печати нет.
   */
  period?: { from: string; to: string } | null;
  /** Лист врача или семьи: у семьи в подвале телефон клиники. */
  audience?: "family" | "staff";
  /**
   * Пришли ли все записи периода. Список отдаётся страницей (до 200 записей),
   * и итог, посчитанный по странице, занижал бы число приступов — врач судит
   * по нему о течении болезни. Неполной сетке итога за период нет.
   */
  complete?: boolean;
}) {
  const { t } = useTranslation("diary");
  const grid = useMemo(() => buildSeizureGrid(logs, types), [logs, types]);

  // В легенде — только типы, которые есть на сетке: она объясняет коды в
  // клетках, а не перечисляет справочник. Полный перечень из двух десятков
  // типов под сеткой с одним приступом прятал нужную строку. Прежние типы
  // (до ILAE 2025) подписаны как прежние (ADR-0050).
  const used = new Set(
    logs.flatMap((log) =>
      log.kind === "seizures" ? [log.seizure_type_id] : [],
    ),
  );
  const legend = types
    .filter((type) => type.code && used.has(type.id))
    .map((type) =>
      type.retired
        ? `${type.code} — ${t("grid.retiredType", { name: type.name })}`
        : `${type.code} — ${type.name}`,
    )
    .join(", ");

  return (
    <Section
      title={t("grid.title")}
      description={grid.rows.length === 0 ? undefined : t("grid.hint")}
      action={
        patientName !== undefined &&
        period !== undefined &&
        period !== null &&
        grid.rows.length > 0 &&
        complete ? (
          // Только полная сетка: итог по неполной странице занижал бы число
          // приступов, а на бумаге оговорку «не все записи» не прочтут.
          <GridPrintButton
            grid={grid}
            legend={legend}
            patientName={patientName}
            period={period}
            audience={audience}
          />
        ) : undefined
      }
    >
      {grid.rows.length === 0 ? (
        <EmptyState size="inline" title={t("grid.empty")} />
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
              {complete && (
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
              )}
            </table>
          </div>

          {!complete && (
            <p className="m-0 text-sm text-muted-foreground">
              {t("grid.incomplete")}
            </p>
          )}

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

/**
 * Сколько дней помещается на лист. Длинная сетка делится на листы со своей
 * шапкой и номером страницы: перетёкшая сама, она осталась бы на второй
 * странице без имени ребёнка.
 */
export const GRID_ROWS_PER_SHEET = 28;

/** Сетка на бумаге: те же клетки, чёрные линии; итог — на последнем листе. */
function PrintedSeizureGrid({
  rows,
  total,
  legend,
  patientName,
  period,
  first,
}: {
  rows: ReturnType<typeof buildSeizureGrid>["rows"];
  /** Итог за период; `null` — лист не последний. */
  total: number | null;
  legend: string;
  patientName: string;
  period: { from: string; to: string };
  first: boolean;
}) {
  const { t } = useTranslation("diary");
  const day = (value: string) => FULL_DATE.format(new Date(value));

  return (
    <div className="flex flex-col gap-[4mm] text-[11pt]">
      <div className="flex flex-col gap-[1mm]">
        <h1 className="m-0 text-[18pt] leading-tight font-bold">
          {first
            ? t("grid.title")
            : t("grid.printContinued", { title: t("grid.title") })}
        </h1>
        <p className="m-0 text-[#3d4556]">
          {t("grid.printPeriod", {
            name: patientName,
            from: day(period.from),
            to: day(period.to),
          })}
        </p>
      </div>
      <table className="w-full border-collapse text-[10.5pt]">
        <thead>
          <tr>
            <th
              scope="col"
              className="border border-[#8a93a3] px-[2mm] py-[1mm] text-left font-semibold"
            >
              {t("grid.day")}
            </th>
            {DAY_PARTS.map((part) => (
              <th
                key={part.key}
                scope="col"
                className="border border-[#8a93a3] px-[2mm] py-[1mm] text-left font-semibold"
              >
                {t(`grid.parts.${part.key}`)}
              </th>
            ))}
            <th
              scope="col"
              className="border border-[#8a93a3] px-[2mm] py-[1mm] text-right font-semibold"
            >
              {t("grid.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date} className="break-inside-avoid">
              <th
                scope="row"
                className="border border-[#8a93a3] px-[2mm] py-[1mm] text-left font-normal tabular-nums"
              >
                {DATE.format(new Date(`${row.date}T00:00:00`))}
              </th>
              {DAY_PARTS.map((part) => (
                <td
                  key={part.key}
                  className="border border-[#8a93a3] px-[2mm] py-[1mm] tabular-nums"
                >
                  {formatCell(row.cells[part.key]) || "—"}
                </td>
              ))}
              <td className="border border-[#8a93a3] px-[2mm] py-[1mm] text-right font-semibold tabular-nums">
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
        {total !== null && (
          <tfoot>
            <tr>
              <th
                scope="row"
                className="border border-[#8a93a3] px-[2mm] py-[1mm] text-left font-semibold"
              >
                {t("grid.periodTotal")}
              </th>
              <td
                colSpan={DAY_PARTS.length}
                className="border border-[#8a93a3]"
              />
              <td className="border border-[#8a93a3] px-[2mm] py-[1mm] text-right font-bold tabular-nums">
                {total}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      {legend !== "" && (
        <p className="m-0 text-[10pt] text-[#4a5263]">
          {t("grid.legend", { legend })}
        </p>
      )}
    </div>
  );
}

/** Печать сетки — отдельным компонентом: рамке документа нужны запросы бланка. */
function GridPrintButton({
  grid,
  legend,
  patientName,
  period,
  audience,
}: {
  grid: ReturnType<typeof buildSeizureGrid>;
  legend: string;
  patientName: string;
  period: { from: string; to: string };
  audience: "family" | "staff";
}) {
  const { t } = useTranslation("diary");
  const frame = useDocumentFrame();
  const pages: (typeof grid.rows)[] = [];
  for (let at = 0; at < grid.rows.length; at += GRID_ROWS_PER_SHEET) {
    pages.push(grid.rows.slice(at, at + GRID_ROWS_PER_SHEET));
  }
  return (
    <PrintButton label={t("grid.print")}>
      <PrintedSheets
        frame={frame}
        audience={audience}
        sheets={pages.map((rows, index) => ({
          key: `seizures-${index}`,
          title: t("grid.title"),
          aside: patientName,
          code: "KC-SEIZURES-1",
          content: (
            <PrintedSeizureGrid
              rows={rows}
              total={index === pages.length - 1 ? grid.total : null}
              legend={legend}
              patientName={patientName}
              period={period}
              first={index === 0}
            />
          ),
        }))}
      />
    </PrintButton>
  );
}
