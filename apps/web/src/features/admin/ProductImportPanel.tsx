import { Button, DataTable, Section, toast, WarningBanner } from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, FileUp, RotateCcw } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { SubPageHeader } from "../../components/SubPageHeader";
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
    <div className="flex flex-col gap-block">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        onClick={onDone}
      >
        <ArrowLeft aria-hidden="true" />
        {t("products.import.backToList")}
      </Button>

      <SubPageHeader
        title={t("products.import.title")}
        intro={t("products.import.intro")}
      />

      {/* Список колонок повторяет REQUIRED_COLUMNS из
          apps/api/src/api/services/product_import.py — это подсказка к формату
          файла, сами колонки проверяет сервер. */}
      <div className="max-w-md">
        <Field
          ref={fileInput}
          id={`${ids}-file`}
          type="file"
          accept=".csv,text/csv"
          label={t("products.import.file")}
          hint={t("products.import.formatHint")}
          onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
        />
      </div>

      <div className="flex flex-wrap gap-block">
        <Button
          type="button"
          disabled={file === null || importProducts.isPending}
          aria-busy={importProducts.isPending}
          onClick={() => {
            if (file !== null) importProducts.mutate({ file, dryRun: true });
          }}
        >
          <FileUp aria-hidden="true" />
          {importProducts.isPending
            ? t("products.import.checking")
            : t("products.import.check")}
        </Button>
      </div>

      {importProducts.isError && (
        <FormError>
          {errorMessageOf(importProducts.error) ??
            t("common:errors.unexpected")}
        </FormError>
      )}

      {report !== null && (
        <Section
          level={3}
          title={
            report.dry_run
              ? t("products.import.preview.title")
              : t("products.import.result.title")
          }
        >
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
                <Button
                  type="button"
                  disabled={file === null || importProducts.isPending}
                  aria-busy={importProducts.isPending}
                  onClick={() => {
                    if (file === null) return;
                    importProducts.mutate(
                      { file, dryRun: false },
                      {
                        onSuccess: (result) => {
                          if (result.imported > 0) {
                            toast.success(
                              t("products.import.result.imported", {
                                value: result.imported,
                              }),
                            );
                          }
                        },
                      },
                    );
                  }}
                >
                  {t("products.import.confirm")}
                </Button>
              </div>
            </>
          ) : (
            // Успех сюда не попадает: подтверждение действия — тост (правило
            // П16), а «вечный» баннер в потоке страницы оставался висеть и
            // после перехода к следующему файлу, читаясь как состояние экрана.
            // Числа отчёта при этом никуда не делись — они строкой выше.
            //
            // Отказ, наоборот, остаётся на экране: файл загружается одной
            // транзакцией, ошибка разбора отменяет весь импорт, а не отдельные
            // строки (частичная база продуктов хуже, чем её отсутствие), и
            // читать список ошибок администратор будет долго.
            report.imported === 0 && (
              <WarningBanner
                level="danger"
                title={t("products.import.result.failed")}
              >
                {t("products.import.result.nothing")}
              </WarningBanner>
            )
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
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  pickFile(null);
                  if (fileInput.current !== null) fileInput.current.value = "";
                }}
              >
                <RotateCcw aria-hidden="true" />
                {t("products.import.another")}
              </Button>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
