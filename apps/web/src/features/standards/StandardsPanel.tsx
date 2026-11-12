import {
  AsyncSection,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Section,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock, Plus, Scale } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { TableSkeleton } from "../admin/TableSkeleton";
import { useSession } from "../auth/useSession";
import { StandardFormSheet, type StandardEditing } from "./StandardFormSheet";
import {
  DEFAULT_FOOD_STANDARD_ID,
  useFoodStandards,
  useLockStandardMutation,
  useUpdateStandardMutation,
  type FoodStandard,
} from "./useFoodStandards";
import { toStandardUpdateBody, toStandardValues } from "./standardSchema";

/**
 * Стандарты питания (ADR-0057): по какому набору значений собирается меню.
 *
 * Закрывает стандарт только администратор, и только внешний документ: сервер
 * проверяет то же самое, здесь кнопки нет, чтобы не обещать заведомый отказ.
 */
export function StandardsPanel({
  onOpen,
  onMerge,
}: {
  /** Показать продукты стандарта в справочнике */
  onOpen: (standardId: string) => void;
  /** Собрать рабочий справочник из источников (ADR-0068) */
  onMerge?: (standardId: string) => void;
}) {
  const { t } = useTranslation("products");
  const { session } = useSession();
  const standards = useFoodStandards();
  const [editing, setEditing] = useState<StandardEditing | null>(null);
  const canLock = session?.role === "admin";

  const rows = useMemo(() => standards.data ?? [], [standards.data]);

  const columns = useMemo<ColumnDef<FoodStandard, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("standards.columns.name"),
        cell: ({ row }) => (
          <span className="flex flex-col leading-tight">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {[
                row.original.publisher,
                row.original.document,
                row.original.version,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "diet_type",
        header: t("standards.columns.diet"),
        cell: ({ row }) => t(`standards.diet.${row.original.diet_type}`),
      },
      {
        accessorKey: "carbs_convention",
        header: t("standards.columns.carbs"),
        cell: ({ row }) =>
          t(`standards.carbs.${row.original.carbs_convention}`),
      },
      {
        accessorKey: "products",
        header: t("standards.columns.products"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.products}</span>
        ),
      },
      {
        accessorKey: "locked_at",
        header: t("standards.columns.state"),
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            <Badge variant={row.original.locked_at ? "outline" : "secondary"}>
              {row.original.locked_at && <Lock aria-hidden="true" />}
              {t(
                row.original.locked_at
                  ? "standards.state.locked"
                  : "standards.state.open",
              )}
            </Badge>
            {!row.original.is_active && (
              <Badge variant="outline">{t("standards.state.retired")}</Badge>
            )}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("standards.columns.actions"),
        enableSorting: false,
        cell: ({ row }) => (
          <StandardActions
            standard={row.original}
            canLock={canLock}
            onOpen={onOpen}
            onMerge={onMerge}
            onEdit={setEditing}
          />
        ),
      },
    ],
    [t, canLock, onOpen, onMerge],
  );

  return (
    <Section
      title={t("standards.title")}
      description={t("standards.intro")}
      action={
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing({ kind: "create" })}
        >
          <Plus aria-hidden="true" />
          {t("standards.create")}
        </Button>
      }
    >
      <AsyncSection
        {...queryState(standards)}
        skeleton={<TableSkeleton label={t("standards.loading")} columns={4} />}
        error={
          standards.isError
            ? {
                title: t("standards.loadError"),
                description:
                  errorMessageOf(standards.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void standards.refetch()}
        isEmpty={rows.length === 0}
        empty={<EmptyState icon={Scale} title={t("standards.empty")} />}
      >
        <DataTable
          columns={columns}
          data={rows}
          caption={t("standards.caption")}
          emptyState={null}
          pageSize={0}
          labels={{
            previousPage: t("common:actions.retry"),
            nextPage: t("common:actions.retry"),
            pageStatus: () => "",
          }}
        />
      </AsyncSection>

      {editing !== null && (
        <StandardFormSheet editing={editing} onClose={() => setEditing(null)} />
      )}
    </Section>
  );
}

function StandardActions({
  standard,
  canLock,
  onOpen,
  onMerge,
  onEdit,
}: {
  standard: FoodStandard;
  canLock: boolean;
  onOpen: (standardId: string) => void;
  onMerge?: (standardId: string) => void;
  onEdit: (editing: StandardEditing) => void;
}) {
  const { t } = useTranslation("products");
  const lock = useLockStandardMutation();
  const update = useUpdateStandardMutation(standard.id);

  const failed = (error: unknown) =>
    toast.error(errorMessageOf(error) ?? t("common:errors.unexpected"));
  const forRow = (action: string) =>
    t("standards.actions.forRow", { action, name: standard.name });

  const setActive = (active: boolean) =>
    update.mutate(toStandardUpdateBody(toStandardValues(standard), active), {
      onSuccess: () =>
        toast.success(
          t(active ? "standards.restored" : "standards.retired", {
            name: standard.name,
          }),
        ),
      onError: failed,
    });

  const locked = standard.locked_at != null;
  const isMain = standard.id === DEFAULT_FOOD_STANDARD_ID;
  const openLabel = t("standards.actions.open");
  const editLabel = t("standards.actions.edit");
  const editionLabel = t("standards.actions.edition");
  const lockLabel = t("standards.actions.lock");
  const retireLabel = t(
    standard.is_active
      ? "standards.actions.retire"
      : "standards.actions.restore",
  );

  return (
    <div className="flex flex-wrap gap-field">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={forRow(openLabel)}
        onClick={() => onOpen(standard.id)}
      >
        {openLabel}
      </Button>

      {/* Собирается только открытый стандарт клиники: сервер откажет иначе. */}
      {onMerge !== undefined && standard.kind === "clinic" && !locked && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={forRow(t("standards.actions.merge"))}
          onClick={() => onMerge(standard.id)}
        >
          {t("standards.actions.merge")}
        </Button>
      )}

      {!locked && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={forRow(editLabel)}
          onClick={() => onEdit({ kind: "edit", standard })}
        >
          {editLabel}
        </Button>
      )}

      {standard.kind === "reference" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={forRow(editionLabel)}
          onClick={() => onEdit({ kind: "edition", standard })}
        >
          {editionLabel}
        </Button>
      )}

      {/* Основной стандарт сервер снять не даст: по нему работают семья и бот.
          В архив — только с подтверждением (ADR-0072): источник пропадает из
          выбора у всех, и прежде одно случайное нажатие в строке таблицы
          делало это молча. Вернуть из архива — без вопроса: это ничего не
          прячет. */}
      {!isMain &&
        (standard.is_active ? (
          <ConfirmDialog
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={update.isPending}
                aria-label={forRow(retireLabel)}
              >
                {retireLabel}
              </Button>
            }
            title={t("standards.confirmRetire.title", { name: standard.name })}
            description={t("standards.confirmRetire.body")}
            confirmLabel={t("standards.confirmRetire.confirm")}
            cancelLabel={t("common:actions.cancel")}
            onConfirm={() => setActive(false)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={update.isPending}
            aria-label={forRow(retireLabel)}
            onClick={() => setActive(true)}
          >
            {retireLabel}
          </Button>
        ))}

      {canLock && standard.kind === "reference" && !locked && (
        <ConfirmDialog
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={lock.isPending}
              aria-label={forRow(lockLabel)}
            >
              <Lock aria-hidden="true" />
              {lockLabel}
            </Button>
          }
          title={t("standards.confirmLock.title", { name: standard.name })}
          description={t("standards.confirmLock.body", {
            count: standard.products,
          })}
          confirmLabel={t("standards.confirmLock.confirm")}
          cancelLabel={t("common:actions.cancel")}
          onConfirm={() =>
            lock.mutate(standard.id, {
              onSuccess: () => toast.success(t("standards.locked")),
              onError: failed,
            })
          }
        />
      )}
    </div>
  );
}
