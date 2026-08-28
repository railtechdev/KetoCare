import { DataTable, WarningBanner } from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useImportProductsMutation } from "./useAdminProducts";
import type { ImportRowError } from "./types";

/**
 * CSV-импорт продуктов (раздел 8.3 ТЗ: «CSV-импорт с превью и отчётом об
 * ошибках построчно»).
 *
 * Порядок жёсткий: сначала `dry_run=true` — сервер разбирает файл и возвращает
 * отчёт, ничего не записав, — и только потом подтверждённый импорт. Отчёт и
 * есть главная ценность экрана: база продуктов задаёт числа, по которым
 * считается меню ребёнка, и «залить и посмотреть» тут не работает.
 */
export function ProductImportPanel({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("admin");
  const ids = useId();

  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importProducts = useImportProductsMutation();

  const report = importProducts.data ?? null;
  const errors = useMemo(() => report?.errors ?? [], [report]);

  // Ошибок может быть несколько на одну строку (по колонке на каждую), поэтому
  // «строк с ошибками» считается по разным номерам, а не по длине списка.
  const errorRows = useMemo(
    () => new Set(errors.map((error) => error.line)).size,
    [errors],
  );

  const columns = useMemo<ColumnDef<ImportRowError, unknown>[]>(
    () => [
      {
        accessorKey: "line",
        header: t("products.import.errors.line"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {/* Строки с данными нумеруются с 2: 0 — ошибка файла целиком
                (кодировка), 1 — ошибка заголовка. Номер «0» в отчёте выглядел
                бы опечаткой. */}
            {row.original.line === 0
              ? t("products.import.errors.fileScope")
              : row.original.line === 1
                ? t("products.import.errors.headerScope")
                : row.original.line}
          </span>
        ),
      },
      {
        accessorKey: "column",
        header: t("products.import.errors.column"),
        cell: ({ row }) => row.original.column ?? "—",
      },
      { accessorKey: "message", header: t("products.import.errors.message") },
    ],
    [t],
  );

  function pickFile(next: File | null) {
    setFile(next);
    // Прошлый отчёт относится к прошлому файлу: оставить его на экране —
    // предложить подтвердить импорт по чужому превью.
    importProducts.reset();
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-lg font-semibold">
        {t("products.import.title")}
      </h2>
      <p className="m-0 text-muted-foreground">{t("products.import.intro")}</p>

      {/* Список колонок повторяет REQUIRED_COLUMNS из
          apps/api/src/api/services/product_import.py — это подсказка к формату
          файла, сами колонки проверяет сервер. */}
      <p className="m-0 text-sm text-muted-foreground">
        {t("products.import.formatHint")}
      </p>

      <div>
        <label
          className="mb-1.5 block text-sm font-medium"
          htmlFor={`${ids}-file`}
        >
          {t("products.import.file")}
        </label>
        <input
          ref={fileInput}
          id={`${ids}-file`}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
          className="min-h-touch w-full max-w-md rounded-lg border border-border bg-card px-3 py-2.5 text-foreground"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={file === null || importProducts.isPending}
          onClick={() => {
            if (file !== null) importProducts.mutate({ file, dryRun: true });
          }}
          className="min-h-touch rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60"
        >
          {importProducts.isPending
            ? t("products.import.checking")
            : t("products.import.check")}
        </button>

        <button
          type="button"
          onClick={onDone}
          className="min-h-touch rounded-lg border border-border px-4 text-foreground"
        >
          {t("products.import.backToList")}
        </button>
      </div>

      {importProducts.isError && (
        <FormError>
          {errorMessageOf(importProducts.error) ??
            t("common:errors.unexpected")}
        </FormError>
      )}

      {report !== null && (
        <section className="flex flex-col gap-3">
          <h3 className="m-0 text-base font-semibold">
            {report.dry_run
              ? t("products.import.preview.title")
              : t("products.import.result.title")}
          </h3>

          <p className="m-0 tabular-nums">
            {t("products.import.preview.totalRows", {
              value: report.total_rows,
            })}
            {" · "}
            {t("products.import.preview.errorRows", { value: errorRows })}
          </p>

          {report.dry_run ? (
            <>
              <p className="m-0 text-sm text-muted-foreground">
                {t("products.import.preview.note")}
              </p>
              <div>
                <button
                  type="button"
                  disabled={file === null || importProducts.isPending}
                  onClick={() => {
                    if (file !== null)
                      importProducts.mutate({ file, dryRun: false });
                  }}
                  className="min-h-touch rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {t("products.import.confirm")}
                </button>
              </div>
            </>
          ) : report.imported > 0 ? (
            <WarningBanner
              level="info"
              title={t("products.import.result.done")}
            >
              {t("products.import.result.imported", {
                value: report.imported,
              })}
            </WarningBanner>
          ) : (
            // Файл загружается одной транзакцией: ошибка разбора отменяет весь
            // импорт, а не отдельные строки (частичная база продуктов хуже, чем
            // её отсутствие).
            <WarningBanner
              level="danger"
              title={t("products.import.result.failed")}
            >
              {t("products.import.result.nothing")}
            </WarningBanner>
          )}

          {errors.length > 0 && (
            <DataTable
              columns={columns}
              data={errors}
              caption={t("products.import.errors.caption")}
              emptyState={t("products.import.errors.none")}
              labels={{
                previousPage: t("table.previousPage"),
                nextPage: t("table.nextPage"),
                pageStatus: (page, total) =>
                  t("table.pageStatus", { page, total }),
              }}
            />
          )}

          {!report.dry_run && (
            <div>
              <button
                type="button"
                onClick={() => {
                  pickFile(null);
                  if (fileInput.current !== null) fileInput.current.value = "";
                }}
                className="min-h-touch rounded-lg border border-border px-4 text-foreground"
              >
                {t("products.import.another")}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
