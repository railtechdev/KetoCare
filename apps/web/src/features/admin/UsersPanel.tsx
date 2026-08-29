import {
  AsyncSection,
  Button,
  DataTable,
  EmptyState,
  formatOccurredAt,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { InvitePanel } from "../invitations/InvitePanel";
import type { Role } from "../invitations/useInvitations";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { SubPageHeader } from "../../components/SubPageHeader";
import { TableSkeleton } from "./TableSkeleton";
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
const STAFF_ROLES: readonly Role[] = ["doctor", "dietitian", "admin"];

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
              row.original.is_active
                ? "text-success"
                : "text-muted-foreground italic"
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
            <span className="text-sm text-muted-foreground">
              {t("users.self")}
            </span>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetUpdate();
                setEditingId(row.original.id);
              }}
            >
              {t("users.edit")}
            </Button>
          ),
      },
    ],
    [t, currentUserId, resetUpdate],
  );

  return (
    <div className="flex flex-col gap-block">
      <SubPageHeader title={t("users.title")} intro={t("users.intro")} />

      {/* Администратор заводит персонал; семью приглашает её врач или диетолог,
          он же становится ведущим специалистом (ADR-0003). */}
      <InvitePanel roles={STAFF_ROLES} />

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
              {
                onSuccess: (saved) => {
                  setEditingId(null);
                  toast.success(t("users.saved", { name: saved.full_name }));
                },
              },
            )
          }
        />
      )}

      {/* Ошибка не прячет уже загруженные строки — правило в AsyncSection. */}
      <AsyncSection
        loading={users.isLoading}
        skeleton={<TableSkeleton label={t("users.loading")} columns={6} />}
        error={
          users.isError
            ? {
                title: t("users.error"),
                description:
                  errorMessageOf(users.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void users.refetch()}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={Users}
            title={t("users.empty.title")}
            description={t("users.empty.description")}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          caption={t("users.table.caption")}
          emptyState={null}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      </AsyncSection>

      {users.data !== undefined && users.data.total > rows.length && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("table.truncated", {
            shown: rows.length,
            total: users.data.total,
          })}
        </p>
      )}
    </div>
  );
}
