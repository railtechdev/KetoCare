import {
  ActionReason,
  Button,
  DataTable,
  Section,
  WarningBanner,
  formatKcal,
  formatRatio,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { FileUp } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import {
  useImportRecipesMutation,
  type RecipeImportError,
  type RecipeImportRow,
} from "./useRecipeImport";

/**
 * CSV-импорт рецептов (раздел 15 п. 24 ТЗ).
 *
 * Порядок тот же, что у продуктов: сначала `dry_run=true` — сервер разбирает
 * файл и возвращает отчёт, ничего не записав, — и только потом подтверждённый
 * импорт.
 *
 * Отличие от продуктов одно, и оно важное: в превью показывается **что посчитало
 * ядро** — калорийность и кетосоотношение каждого рецепта. Это и есть проверка
 * файла по существу. Состав, давший 0,4 : 1 вместо ожидаемых 4 : 1, виден до
 * записи, а не после того, как по нему начали готовить.
 */
export function RecipeImportPanel({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("recipes");
  const ids = useId();

  const [file, setFile] = useState<File | null>(null);
  // Проверка и запись — две мутации (как у импорта продуктов): у одной общий
  // `isPending`, и во время записи кнопка проверки говорила «Проверяем…».
  const preview = useImportRecipesMutation();
  const commit = useImportRecipesMutation();
  const busy = preview.isPending || commit.isPending;
  const failure = commit.error ?? preview.error;

  const report = commit.data ?? preview.data ?? null;
  const errors = useMemo(() => report?.errors ?? [], [report]);

  // Ошибок бывает несколько на одну строку (по колонке на каждую), поэтому
  // «строк с ошибками» считается по разным номерам, а не по длине списка.
  const errorRows = useMemo(
    () => new Set(errors.map((error) => error.line)).size,
    [errors],
  );

  // Подписи постраничности — общие для всех таблиц кабинета (правило 8: строк
  // в разметке не бывает).
  const tableLabels = useMemo(
    () => ({
      previousPage: t("table.previousPage"),
      nextPage: t("table.nextPage"),
      pageStatus: (page: number, total: number) =>
        t("table.pageStatus", { page, total }),
    }),
    [t],
  );

  const errorColumns = useMemo<ColumnDef<RecipeImportError, unknown>[]>(
    () => [
      {
        accessorKey: "line",
        header: t("import.errors.line"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {/* Строки с данными нумеруются с 2: 0 — ошибка файла целиком
                (кодировка или колонки). Номер «0» в отчёте выглядел бы
                опечаткой. */}
            {row.original.line === 0
              ? t("import.errors.fileScope")
              : row.original.line}
          </span>
        ),
      },
      { accessorKey: "column", header: t("import.errors.column") },
      { accessorKey: "message", header: t("import.errors.message") },
    ],
    [t],
  );

  const recipeColumns = useMemo<ColumnDef<RecipeImportRow, unknown>[]>(
    () => [
      { accessorKey: "title", header: t("import.preview.recipe") },
      {
        accessorKey: "ingredients",
        header: t("import.preview.ingredients"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.ingredients}</span>
        ),
      },
      {
        accessorKey: "kcal",
        header: t("import.preview.kcal"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.kcal == null ? "—" : formatKcal(row.original.kcal)}
          </span>
        ),
      },
      {
        accessorKey: "ratio",
        header: t("import.preview.ratio"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.ratio == null ? "—" : formatRatio(row.original.ratio)}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <PageLayout
      title={t("import.title")}
      intro={t("import.intro")}
      width="content"
      onBack={onDone}
    >
      <div className="flex flex-col gap-section">
        <div className="max-w-md">
          <Field
            id={`${ids}-file`}
            type="file"
            accept=".csv,text/csv"
            label={t("import.file")}
            hint={t("import.formatHint")}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              // Отчёт относится к прежнему файлу: оставить его на экране значит
              // показывать ответ про другой.
              preview.reset();
              commit.reset();
            }}
          />
        </div>

        <div className="flex flex-col items-start gap-field">
          <Button
            type="button"
            disabled={file === null || busy}
            aria-busy={preview.isPending}
            aria-describedby={`${ids}-check-reason`}
            onClick={() => {
              if (file === null) return;
              commit.reset();
              preview.mutate({ file, dryRun: true });
            }}
          >
            <FileUp aria-hidden="true" />
            {preview.isPending ? t("import.checking") : t("import.check")}
          </Button>
          {/* Причина отключённой кнопки (П44); во время проверки её нет. */}
          <ActionReason id={`${ids}-check-reason`}>
            {file === null ? t("common:actions.noFileChosen") : null}
          </ActionReason>
        </div>

        {failure !== null && (
          <FormError>
            {errorMessageOf(failure) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        {report !== null && (
          // Второй уровень: над отчётом стоит только заголовок экрана (h1
          // у PageLayout), и h3 пропускал бы уровень (П24).
          <Section
            title={
              report.dry_run
                ? t("import.preview.title")
                : t("import.result.title")
            }
          >
            <p className="m-0 tabular-nums">
              {t("import.preview.totalRows", { value: report.total_rows })}
              {" · "}
              {t("import.preview.errorRows", { value: errorRows })}
              {report.dry_run && (
                <>
                  {" · "}
                  {t("import.preview.willImport", { value: report.imported })}
                </>
              )}
            </p>

            {report.recipes.length > 0 && (
              <DataTable
                columns={recipeColumns}
                data={report.recipes}
                labels={tableLabels}
                caption={t("import.preview.caption")}
                emptyState={t("import.preview.none")}
              />
            )}

            {report.dry_run ? (
              <>
                <p className="m-0 text-sm text-muted-foreground">
                  {t("import.preview.note")}
                </p>
                <div className="flex flex-col items-start gap-field">
                  <Button
                    type="button"
                    disabled={file === null || busy || report.imported === 0}
                    aria-busy={commit.isPending}
                    aria-describedby={`${ids}-commit-reason`}
                    onClick={() => {
                      if (file === null) return;
                      commit.mutate(
                        { file, dryRun: false },
                        {
                          onSuccess: (result) => {
                            if (result.imported > 0) {
                              toast.success(
                                t("import.result.imported", {
                                  value: result.imported,
                                }),
                              );
                            }
                          },
                        },
                      );
                    }}
                  >
                    {commit.isPending
                      ? t("import.importing")
                      : t("import.confirm")}
                  </Button>
                  {/* Все строки с ошибками — загружать нечего, и кнопка
                      говорит об этом, а не молчит серым (П44). */}
                  <ActionReason id={`${ids}-commit-reason`}>
                    {report.imported === 0 && !busy
                      ? t("import.preview.nothingToImport")
                      : null}
                  </ActionReason>
                </div>
              </>
            ) : (
              // Успех — тостом (правило П16 канона), а не баннером в потоке:
              // баннер оставался бы висеть и после перехода к следующему файлу,
              // читаясь как состояние экрана. Отказ, наоборот, остаётся: файл
              // импортируется одной транзакцией, и читать список ошибок будут
              // долго.
              report.imported === 0 && (
                <WarningBanner level="danger" title={t("import.result.failed")}>
                  {t("import.result.nothing")}
                </WarningBanner>
              )
            )}

            {errors.length > 0 && (
              <DataTable
                columns={errorColumns}
                data={errors}
                labels={tableLabels}
                caption={t("import.errors.caption")}
                emptyState={t("import.errors.none")}
              />
            )}
          </Section>
        )}
      </div>
    </PageLayout>
  );
}
