import { DataTable, formatOccurredAt } from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { AuditPayload } from "./AuditPayload";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  AUDIT_PAGE_SIZE,
  EMPTY_AUDIT_FILTERS,
  isRangeInvalid,
  isUserIdInvalid,
  type AuditFilters,
} from "./auditFilters";
import { shortId } from "./format";
import { useAuditLog } from "./useAuditLog";
import type { AuditEntry } from "./types";
import { FIELD_CONTROL } from "../../components/Field";

/**
 * Журнал аудита (раздел 8.1 ТЗ, раздел админа `audit`).
 *
 * Только чтение: записи не правятся и не удаляются, иначе журнал перестаёт быть
 * доказательством того, кто менял назначения, продукты и учётные записи.
 */
export function AuditPanel() {
  const { t } = useTranslation("admin");

  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [offset, setOffset] = useState(0);

  const userIdInvalid = isUserIdInvalid(filters);
  const rangeInvalid = isRangeInvalid(filters);

  // Заведомо неверный фильтр на сервер не уходит: он вернул бы 422, а на экране
  // это выглядит как поломка журнала, а не как опечатка в поле.
  const auditLog = useAuditLog(
    filters,
    offset,
    !userIdInvalid && !rangeInvalid,
  );

  const rows = useMemo(() => auditLog.data?.items ?? [], [auditLog.data]);
  const total = auditLog.data?.total ?? 0;

  function patchFilters(patch: Partial<AuditFilters>) {
    // Любая смена фильтра возвращает к первой странице: иначе выдача открылась
    // бы на середине уже другой выборки.
    setFilters((current) => ({ ...current, ...patch }));
    setOffset(0);
  }

  const columns = useMemo<ColumnDef<AuditEntry, unknown>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: t("audit.columns.createdAt"),
        cell: ({ row }) => (
          <time
            className="whitespace-nowrap tabular-nums"
            dateTime={row.original.created_at}
          >
            {formatOccurredAt(new Date(row.original.created_at))}
          </time>
        ),
      },
      {
        accessorKey: "user_id",
        header: t("audit.columns.user"),
        cell: ({ row }) =>
          row.original.user_id === null ? (
            <span className="text-muted">{t("audit.noUser")}</span>
          ) : (
            <span title={row.original.user_id} className="tabular-nums">
              {shortId(row.original.user_id)}
            </span>
          ),
      },
      {
        accessorKey: "action",
        header: t("audit.columns.action"),
        // Незнакомое действие показывается как есть: список подписей отстаёт от
        // сервера, а скрывать событие журнала из-за отсутствия перевода нельзя.
        cell: ({ row }) =>
          t(`audit.actions.${row.original.action}`, {
            defaultValue: row.original.action,
          }),
      },
      {
        accessorKey: "entity",
        header: t("audit.columns.entity"),
        cell: ({ row }) =>
          t(`audit.entities.${row.original.entity}`, {
            defaultValue: row.original.entity,
          }),
      },
      {
        accessorKey: "entity_id",
        header: t("audit.columns.entityId"),
        cell: ({ row }) =>
          row.original.entity_id === null ? (
            "—"
          ) : (
            <span title={row.original.entity_id} className="tabular-nums">
              {shortId(row.original.entity_id)}
            </span>
          ),
      },
      {
        accessorKey: "ip",
        header: t("audit.columns.ip"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.ip ?? "—"}</span>
        ),
      },
      {
        id: "payload",
        header: t("audit.columns.payload"),
        enableSorting: false,
        cell: ({ row }) => <AuditPayload entry={row.original} />,
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-lg font-semibold">{t("audit.title")}</h2>
      <p className="m-0 text-muted">{t("audit.intro")}</p>

      <fieldset className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="sr-only">{t("audit.filters.legend")}</legend>

        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor="audit-user"
          >
            {t("audit.filters.user")}
          </label>
          <input
            id="audit-user"
            value={filters.userId}
            onChange={(event) => patchFilters({ userId: event.target.value })}
            placeholder={t("audit.filters.userPlaceholder")}
            aria-invalid={userIdInvalid ? true : undefined}
            aria-describedby={userIdInvalid ? "audit-user-error" : undefined}
            className={FIELD_CONTROL}
          />
          {userIdInvalid && (
            <p id="audit-user-error" className="mt-1 text-sm text-danger">
              {t("audit.filters.userInvalid")}
            </p>
          )}
        </div>

        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor="audit-entity"
          >
            {t("audit.filters.entity")}
          </label>
          <select
            id="audit-entity"
            value={filters.entity}
            onChange={(event) => patchFilters({ entity: event.target.value })}
            className={FIELD_CONTROL}
          >
            <option value="">{t("audit.filters.anyEntity")}</option>
            {AUDIT_ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {t(`audit.entities.${entity}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor="audit-action"
          >
            {t("audit.filters.action")}
          </label>
          <select
            id="audit-action"
            value={filters.action}
            onChange={(event) => patchFilters({ action: event.target.value })}
            className={FIELD_CONTROL}
          >
            <option value="">{t("audit.filters.anyAction")}</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {t(`audit.actions.${action}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor="audit-from"
          >
            {t("audit.filters.from")}
          </label>
          <input
            id="audit-from"
            type="date"
            value={filters.from}
            onChange={(event) => patchFilters({ from: event.target.value })}
            className={FIELD_CONTROL}
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor="audit-to"
          >
            {t("audit.filters.to")}
          </label>
          <input
            id="audit-to"
            type="date"
            value={filters.to}
            onChange={(event) => patchFilters({ to: event.target.value })}
            aria-invalid={rangeInvalid ? true : undefined}
            aria-describedby={rangeInvalid ? "audit-to-error" : undefined}
            className={FIELD_CONTROL}
          />
          {rangeInvalid && (
            <p id="audit-to-error" className="mt-1 text-sm text-danger">
              {t("audit.filters.rangeInvalid")}
            </p>
          )}
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY_AUDIT_FILTERS);
              setOffset(0);
            }}
            className="min-h-touch w-full rounded-lg border border-line px-4 text-ink"
          >
            {t("audit.filters.reset")}
          </button>
        </div>
      </fieldset>

      {auditLog.isError && (
        <FormError>
          {errorMessageOf(auditLog.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {auditLog.isLoading ? (
        <p role="status" className="text-muted">
          {t("audit.loading")}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          caption={t("audit.table.caption")}
          emptyState={t("audit.empty")}
          // Постраничность серверная: журнал длинный, и целиком он не грузится.
          pageSize={0}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, pages) =>
              t("table.pageStatus", { page, total: pages }),
          }}
        />
      )}

      {total > 0 && (
        <nav
          aria-label={t("audit.pagination.label")}
          className="flex items-center gap-3"
        >
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - AUDIT_PAGE_SIZE))}
            className="min-h-touch rounded-lg border border-line px-3 text-ink disabled:opacity-50"
          >
            {t("table.previousPage")}
          </button>
          <span role="status" className="text-sm text-muted tabular-nums">
            {t("audit.pagination.range", {
              from: offset + 1,
              to: offset + rows.length,
              total,
            })}
          </span>
          <button
            type="button"
            disabled={offset + rows.length >= total}
            onClick={() => setOffset(offset + AUDIT_PAGE_SIZE)}
            className="min-h-touch rounded-lg border border-line px-3 text-ink disabled:opacity-50"
          >
            {t("table.nextPage")}
          </button>
        </nav>
      )}
    </div>
  );
}
