import { DataTable, formatOccurredAt } from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { UserAccountForm } from "./UserAccountForm";
import { useAdminUsers, useUpdateUserMutation } from "./useAdminUsers";
import type { AdminUser } from "./types";

/**
 * Учётные записи (раздел 8.1 ТЗ, раздел админа `users`).
 *
 * Правка идёт через PATCH: роль и активность. Собственную учётную запись
 * изменить нельзя — сервер отклоняет и отключение себя, и смену своей роли
 * (иначе последний администратор может лишить систему администрирования), а
 * интерфейс не предлагает того, что заведомо не пройдёт.
 */
export function UsersPanel() {
  const { t } = useTranslation("admin");
  const { session } = useSession();

  const users = useAdminUsers();
  const update = useUpdateUserMutation();
  const [editingId, setEditingId] = useState<string | null>(null);

  const currentUserId = session?.userId ?? null;
  const resetUpdate = update.reset;

  const rows = useMemo(() => users.data?.items ?? [], [users.data]);
  const editing = rows.find((user) => user.id === editingId) ?? null;

  const columns = useMemo<ColumnDef<AdminUser, unknown>[]>(
    () => [
      { accessorKey: "full_name", header: t("users.columns.name") },
      { accessorKey: "email", header: t("users.columns.email") },
      {
        accessorKey: "role",
        header: t("users.columns.role"),
        cell: ({ row }) => t(`common:roles.${row.original.role}`),
      },
      {
        accessorKey: "is_active",
        header: t("users.columns.status"),
        cell: ({ row }) => (
          <span
            className={
              row.original.is_active ? "text-success" : "text-muted italic"
            }
          >
            {row.original.is_active
              ? t("users.status.active")
              : t("users.status.inactive")}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: t("users.columns.createdAt"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatOccurredAt(new Date(row.original.created_at))}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("users.columns.actions"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.id === currentUserId ? (
            <span className="text-sm text-muted">{t("users.self")}</span>
          ) : (
            <button
              type="button"
              onClick={() => {
                resetUpdate();
                setEditingId(row.original.id);
              }}
              className="min-h-touch rounded-lg border border-line px-3 text-ink"
            >
              {t("users.edit")}
            </button>
          ),
      },
    ],
    [t, currentUserId, resetUpdate],
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-lg font-semibold">{t("users.title")}</h2>
      <p className="m-0 text-muted">{t("users.intro")}</p>

      {users.isError && (
        <FormError>
          {errorMessageOf(users.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {editing !== null && (
        <UserAccountForm
          // Форма пересоздаётся при выборе другой учётной записи: react-hook-form
          // читает defaultValues только при монтировании, и без этого в ней
          // остались бы роль и активность предыдущего пользователя.
          key={editing.id}
          user={editing}
          pending={update.isPending}
          error={update.error}
          onCancel={() => setEditingId(null)}
          onSubmit={(changes) =>
            update.mutate(
              { userId: editing.id, changes },
              { onSuccess: () => setEditingId(null) },
            )
          }
        />
      )}

      {update.isSuccess && editing === null && (
        <p role="status" className="m-0 text-success">
          {t("users.saved", { name: update.data.full_name })}
        </p>
      )}

      {users.isLoading ? (
        <p role="status" className="text-muted">
          {t("users.loading")}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          caption={t("users.table.caption")}
          emptyState={t("users.empty")}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      )}

      {users.data !== undefined && users.data.total > rows.length && (
        <p className="m-0 text-sm text-muted">
          {t("table.truncated", {
            shown: rows.length,
            total: users.data.total,
          })}
        </p>
      )}
    </div>
  );
}
