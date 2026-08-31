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
  const [updateExisting, setUpdateExisting] = useState(false);

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

      {/* Режим выбирается ДО проверки: превью обновляющего импорта показывает
          не то же самое, что превью обычного, — там различия существующих
          позиций, а здесь список пропущенных дублей. */}
      <label className="flex items-start gap-field text-sm">
        <input
          type="checkbox"
          className="mt-1 size-5 accent-primary"
          checked={updateExisting}
          onChange={(event) => {
            setUpdateExisting(event.target.checked);
            // Отчёт относится к прежнему режиму: оставить его на экране значит
            // показывать ответ на другой вопрос.
            importProducts.reset();
          }}
        />
        <span>
          <span className="font-medium">
            {t("products.import.updateExisting")}
          </span>
          <span className="block text-muted-foreground">
            {t("products.import.updateExistingHint")}
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-block">
        <Button
          type="button"
          disabled={file === null || importProducts.isPending}
          aria-busy={importProducts.isPending}
          onClick={() => {
            if (file !== null) {
              importProducts.mutate({ file, dryRun: true, updateExisting });
            }
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
            {report.updated > 0 && (
              <>
                {" · "}
                {t("products.import.preview.updatedRows", {
                  value: report.updated,
                })}
              </>
            )}
          </p>

          {/* Что именно перезаписывается — до записи. «Обновлено 412 позиций»
              без перечня это отчёт, который нечем проверить, а переписываются
              числа, по которым считают еду ребёнку. */}
          {report.updates.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-field p-0">
              {report.updates.map((update) => (
                <li key={update.product_id} className="text-sm">
                  <span className="font-medium">{update.name_ru}</span>
                  <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 pl-4">
                    {update.changes.map((change) => (
                      <li key={change.field} className="tabular-nums">
                        <span className="text-muted-foreground">
                          {t(`revisions.fields.${change.field}`, {
                            ns: "products",
                            defaultValue: change.field,
                          })}
                          :{" "}
                        </span>
                        {change.before || "—"}
                        <span aria-hidden="true"> → </span>
                        <span className="font-medium">
                          {change.after || "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

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
                      { file, dryRun: false, updateExisting },
                      {
                        onSuccess: (result) => {
                          if (result.imported > 0) {
                            toast.success(
                              t("products.import.result.imported", {
                                value: result.imported,
                              }),
                            );
                          }
                          if (result.updated > 0) {
                            toast.success(
                              t("products.import.result.updated", {
                                value: result.updated,
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
