import {
  AsyncSection,
  ConfirmDialog,
  FormSheet,
  Button,
  DataTable,
  EmptyState,
  Section,
  formatOccurredAt,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, RotateCcwKey, SearchX, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { InvitationsList } from "../invitations/InvitationsList";
import { InviteForm } from "../invitations/InvitePanel";
import type { Role } from "../invitations/useInvitations";
import { errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { Field, SelectField } from "../../components/Field";
import { useSession } from "../auth/useSession";
import { SubPageHeader } from "../../components/SubPageHeader";
import { TableSkeleton } from "./TableSkeleton";
import { UserAccountForm } from "./UserAccountForm";
import {
  EMPTY_USERS_FILTER,
  useAdminUsers,
  useResetPasswordMutation,
  useResetTotpMutation,
  useUpdateUserMutation,
  type UsersFilter,
} from "./useAdminUsers";
import type { AdminUser } from "./types";

/** Роли для отбора — те же, что назначаются учётной записи. */
const ROLE_OPTIONS = ["admin", "doctor", "dietitian", "parent"] as const;

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

  const [filter, setFilter] = useState<UsersFilter>(EMPTY_USERS_FILTER);
  // Задержка — чтобы запрос уходил не на каждую букву; отбор всё равно делает
  // сервер (см. `useAdminUsers`).
  const debouncedQuery = useDebouncedValue(filter.q, 300);
  const users = useAdminUsers({ ...filter, q: debouncedQuery });
  const update = useUpdateUserMutation();
  const resetTotp = useResetTotpMutation();
  const resetPassword = useResetPasswordMutation();

  /**
   * Выданный временный пароль и чья это запись.
   *
   * Показывается один раз: в базе только argon2-хэш, повторить показ
   * невозможно. Поэтому панель не закрывается сама — администратор должен
   * успеть передать пароль владельцу.
   */
  const [issued, setIssued] = useState<{
    name: string;
    password: string;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

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
            <div className="flex flex-wrap gap-field">
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

              {/* Пароль сбрасывается у любой учётной записи: забыть его может
                  кто угодно, в отличие от второго фактора, которого у части
                  ролей нет вовсе. */}
              <ConfirmDialog
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-touch"
                    aria-label={t("users.resetPasswordAria", {
                      name: row.original.full_name,
                    })}
                  >
                    <RotateCcwKey aria-hidden="true" />
                    {t("users.resetPassword")}
                  </Button>
                }
                title={t("users.confirmResetPasswordTitle", {
                  name: row.original.full_name,
                })}
                description={t("users.confirmResetPasswordBody")}
                confirmLabel={t("users.confirmResetPasswordAction")}
                cancelLabel={t("common:actions.cancel")}
                onConfirm={() =>
                  resetPassword.mutate(row.original.id, {
                    onSuccess: (data) =>
                      setIssued({
                        name: row.original.full_name,
                        password: data.temporary_password,
                      }),
                    onError: (error) =>
                      toast.error(
                        errorMessageOf(error) ?? t("common:errors.unexpected"),
                      ),
                  })
                }
              />

              {/* Кнопки нет, когда второго фактора нет: она вела бы в
                  заведомый 409 (правило П3 канона). Подтверждение называет
                  учётную запись — «сбросить второй фактор» без имени это
                  вопрос без объекта (правило П14). */}
              {row.original.has_totp && (
                <ConfirmDialog
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-touch"
                      aria-label={t("users.resetTotpAria", {
                        name: row.original.full_name,
                      })}
                    >
                      <KeyRound aria-hidden="true" />
                      {t("users.resetTotp")}
                    </Button>
                  }
                  title={t("users.confirmResetTotpTitle", {
                    name: row.original.full_name,
                  })}
                  description={t("users.confirmResetTotpBody")}
                  confirmLabel={t("users.confirmResetTotpAction")}
                  cancelLabel={t("common:actions.cancel")}
                  onConfirm={() =>
                    resetTotp.mutate(row.original.id, {
                      onSuccess: () => toast.success(t("users.totpReset")),
                      onError: (error) =>
                        toast.error(
                          errorMessageOf(error) ??
                            t("common:errors.unexpected"),
                        ),
                    })
                  }
                />
              )}
            </div>
          ),
      },
    ],
    [t, currentUserId, resetUpdate, resetTotp, resetPassword],
  );

  return (
    <div className="flex flex-col gap-block">
      <SubPageHeader
        title={t("users.title")}
        intro={t("users.intro")}
        actions={
          <Button type="button" onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden="true" />
            {t("users.inviteAction")}
          </Button>
        }
      />

      {/* Администратор заводит персонал; семью приглашает её врач или диетолог,
          он же становится ведущим специалистом (ADR-0003).

          Панелью, а не блоком над списком: администратор приходит сюда
          управлять учётными записями, а приглашает сотрудника изредка
          (правило П32 канона). */}
      {/* Временный пароль — панелью, которая не закрывается сама: показать его
          второй раз нельзя (в базе только argon2-хэш), а передать владельцу
          администратор должен успеть. */}
      <FormSheet
        open={issued !== null}
        onOpenChange={(open) => {
          if (!open) setIssued(null);
        }}
        title={t("users.temporaryPasswordTitle")}
        description={t("users.temporaryPasswordBody", { name: issued?.name })}
      >
        <div className="flex flex-col gap-block">
          <p className="m-0 rounded-lg border border-border px-3 py-2 text-center font-mono text-lg tracking-wider">
            {issued?.password}
          </p>
          <div className="flex flex-wrap gap-field">
            <Button
              type="button"
              variant="outline"
              className="min-h-touch"
              onClick={() =>
                void navigator.clipboard?.writeText(issued?.password ?? "")
              }
            >
              {t("users.temporaryPasswordCopy")}
            </Button>
            <Button
              type="button"
              className="min-h-touch"
              onClick={() => setIssued(null)}
            >
              {t("users.temporaryPasswordDone")}
            </Button>
          </div>
        </div>
      </FormSheet>

      <FormSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title={t("invitations:title")}
        description={t("invitations:intro")}
      >
        <InviteForm roles={STAFF_ROLES} />

        {/* Список выданных под формой: администратор видит все приглашения,
            включая выданные врачами семьям. */}
        <InvitationsList />
      </FormSheet>

      {/* Правка учётной записи — тоже панелью: раньше форма раскрывалась над
          таблицей и отодвигала её вниз ровно в тот момент, когда нужно было
          свериться со списком. */}
      <FormSheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
        title={t("users.editTitle")}
      >
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
      </FormSheet>

      {/* Панель отбора — блок экрана, поэтому Section со скрытым заголовком
          (правило П23 канона). */}
      <Section
        title={t("users.filters.legend")}
        titleHidden
        density="compact"
        contentClassName="flex flex-wrap items-end gap-block"
      >
        <Field
          id="users-search"
          type="search"
          label={t("users.filters.search")}
          value={filter.q}
          onChange={(event) =>
            setFilter((current) => ({ ...current, q: event.target.value }))
          }
        />
        <SelectField
          id="users-role"
          label={t("users.filters.role")}
          width="narrow"
          value={filter.role}
          onChange={(event) =>
            setFilter((current) => ({ ...current, role: event.target.value }))
          }
        >
          <option value="">{t("users.filters.anyRole")}</option>
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {t(`common:roles.${role}`)}
            </option>
          ))}
        </SelectField>
        {(filter.q !== "" || filter.role !== "") && (
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
            onClick={() => setFilter(EMPTY_USERS_FILTER)}
          >
            {t("users.filters.reset")}
          </Button>
        )}
      </Section>

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
          filter.q === "" && filter.role === "" ? (
            <EmptyState
              icon={Users}
              title={t("users.empty.title")}
              description={t("users.empty.description")}
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title={t("users.empty.searchTitle")}
              description={t("users.empty.searchDescription")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFilter(EMPTY_USERS_FILTER)}
                >
                  {t("users.filters.reset")}
                </Button>
              }
            />
          )
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
