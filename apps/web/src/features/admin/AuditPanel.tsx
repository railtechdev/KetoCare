import {
  AsyncSection,
  Button,
  DataTable,
  EmptyState,
  formatOccurredAt,
  Section,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { AuditPayload } from "./AuditPayload";
import { useAdminUsers } from "./useAdminUsers";
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
import { SectionLink } from "../../components/SectionLink";
import { SubPageHeader } from "../../components/SubPageHeader";
import { TableSkeleton } from "./TableSkeleton";
import { useAuditLog } from "./useAuditLog";
import type { AuditEntry } from "./types";
import { Field, SelectField } from "../../components/Field";

/**
 * Журнал аудита (раздел 8.1 ТЗ, раздел админа `audit`).
 *
 * Только чтение: записи не правятся и не удаляются, иначе журнал перестаёт быть
 * доказательством того, кто менял назначения, продукты и учётные записи.
 */
export function AuditPanel({ chrome = "tab" }: { chrome?: "tab" | "screen" }) {
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

  function resetFilters() {
    setFilters(EMPTY_AUDIT_FILTERS);
    setOffset(0);
  }

  // Учётные записи — источник имён авторов. Запрашиваются раз и надолго:
  // список сотрудников меняется реже, чем читают журнал.
  const users = useAdminUsers();
  const names = useMemo(
    () =>
      Object.fromEntries(
        (users.data?.items ?? []).map((user) => [user.id, user.full_name]),
      ),
    [users.data],
  );

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
        cell: ({ row }) => {
          const id = row.original.user_id;
          if (id === null) {
            return (
              <span className="text-muted-foreground">{t("audit.noUser")}</span>
            );
          }
          // Имя, а не обрезанный идентификатор: «3f2a…» не отвечает на вопрос
          // «кто это сделал», ради которого журнал и открывают. Справочник
          // учётных записей у администратора уже есть.
          const name = names[id];
          return name === undefined ? (
            <span title={id} className="tabular-nums">
              {shortId(id)}
            </span>
          ) : (
            <span title={id}>{name}</span>
          );
        },
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
        cell: ({ row }) => {
          const id = row.original.entity_id;
          if (id === null) return "—";

          // К продукту можно перейти: он администратору доступен. К
          // клиническим записям — нет и не будет (правило 5 CLAUDE.md), у них
          // остаётся идентификатор, который можно скопировать целиком.
          if (row.original.entity === "products") {
            return (
              <SectionLink section="products" item={id} className="underline">
                {shortId(id)}
              </SectionLink>
            );
          }

          return (
            <span title={id} className="tabular-nums">
              {shortId(id)}
            </span>
          );
        },
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
    [t, names],
  );

  return (
    <div className="flex flex-col gap-block">
      {chrome === "tab" && (
        <SubPageHeader title={t("audit.title")} intro={t("audit.intro")} />
      )}

      {/* Панель фильтров — `Section` со скрытым заголовком, а не голый
          `fieldset`: блок экрана выделяется одним способом (правило П23), а
          `fieldset` остаётся там, где обязателен семантически — у группы
          радиокнопок или флажков с общей подписью. Здесь же это поля разных
          типов, и `Section` с `titleHidden` описан ровно для этого случая. */}
      <Section
        title={t("audit.filters.legend")}
        titleHidden
        density="compact"
        contentClassName="grid gap-block sm:grid-cols-2 lg:grid-cols-3"
      >
        <Field
          id="audit-user"
          label={t("audit.filters.user")}
          placeholder={t("audit.filters.userPlaceholder")}
          value={filters.userId}
          onChange={(event) => patchFilters({ userId: event.target.value })}
          error={userIdInvalid && t("audit.filters.userInvalid")}
        />

        <SelectField
          id="audit-entity"
          width="medium"
          label={t("audit.filters.entity")}
          value={filters.entity}
          onChange={(event) => patchFilters({ entity: event.target.value })}
        >
          <option value="">{t("audit.filters.anyEntity")}</option>
          {AUDIT_ENTITIES.map((entity) => (
            <option key={entity} value={entity}>
              {t(`audit.entities.${entity}`)}
            </option>
          ))}
        </SelectField>

        <SelectField
          id="audit-action"
          width="medium"
          label={t("audit.filters.action")}
          value={filters.action}
          onChange={(event) => patchFilters({ action: event.target.value })}
        >
          <option value="">{t("audit.filters.anyAction")}</option>
          {AUDIT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {t(`audit.actions.${action}`)}
            </option>
          ))}
        </SelectField>

        <Field
          id="audit-from"
          width="date"
          type="date"
          label={t("audit.filters.from")}
          value={filters.from}
          onChange={(event) => patchFilters({ from: event.target.value })}
        />

        <Field
          id="audit-to"
          width="date"
          type="date"
          label={t("audit.filters.to")}
          value={filters.to}
          onChange={(event) => patchFilters({ to: event.target.value })}
          error={rangeInvalid && t("audit.filters.rangeInvalid")}
        />

        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            className="min-h-touch w-full"
            onClick={resetFilters}
          >
            {t("audit.filters.reset")}
          </Button>
        </div>
      </Section>

      {/* Ошибка не прячет уже загруженные строки — правило в AsyncSection. */}
      <AsyncSection
        loading={auditLog.isLoading}
        skeleton={<TableSkeleton label={t("audit.loading")} columns={7} />}
        error={
          auditLog.isError
            ? {
                title: t("audit.error"),
                description:
                  errorMessageOf(auditLog.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void auditLog.refetch()}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={ScrollText}
            title={t("audit.empty.title")}
            description={t("audit.empty.description")}
            action={
              <Button type="button" variant="outline" onClick={resetFilters}>
                {t("audit.filters.reset")}
              </Button>
            }
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          caption={t("audit.table.caption")}
          emptyState={null}
          // Постраничность серверная: журнал длинный, и целиком он не грузится.
          pageSize={0}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, pages) =>
              t("table.pageStatus", { page, total: pages }),
          }}
        />
      </AsyncSection>

      {total > 0 && (
        <nav
          aria-label={t("audit.pagination.label")}
          className="flex flex-wrap items-center gap-block"
        >
          <Button
            type="button"
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - AUDIT_PAGE_SIZE))}
          >
            {t("table.previousPage")}
          </Button>
          <span
            role="status"
            className="text-sm text-muted-foreground tabular-nums"
          >
            {t("audit.pagination.range", {
              from: offset + 1,
              to: offset + rows.length,
              total,
            })}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={offset + rows.length >= total}
            onClick={() => setOffset(offset + AUDIT_PAGE_SIZE)}
          >
            {t("table.nextPage")}
          </Button>
        </nav>
      )}
    </div>
  );
}
