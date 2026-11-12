import {
  AsyncSection,
  Badge,
  ConfirmDialog,
  FormSheet,
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Section,
  SegmentedControl,
  formatOccurredAt,
  toast,
  useDebouncedValue,
  SEARCH_DELAY_MS,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Ellipsis,
  KeyRound,
  RotateCcwKey,
  SearchX,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PageActions } from "../../components/PageLayout";
import {
  useAddressPatch,
  useAddressState,
  useSectionQuery,
  useSectionTab,
} from "../../routes/useSectionTab";
import { copyText } from "../../lib/clipboard";
import { useTranslation } from "react-i18next";

import { InvitationsList } from "../invitations/InvitationsList";
import { InviteForm } from "../invitations/InvitePanel";
import type { Role } from "../invitations/useInvitations";
import { errorMessageOf } from "../../lib/api";
import { Field, SelectField } from "../../components/Field";
import { useSession } from "../auth/useSession";
import { SubPageHeader } from "../../components/SubPageHeader";
import { TableSkeleton } from "./TableSkeleton";
import { CareTransferPanel } from "./CareTransferPanel";
import { UserAccountForm } from "./UserAccountForm";
import {
  useAdminUsers,
  useResetPasswordMutation,
  useResetTotpMutation,
  useUpdateUserMutation,
} from "./useAdminUsers";
import type { AdminUser } from "./types";
import { queryState } from "../../lib/queryState";

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

/** Виды раздела: учётные записи и выданные приглашения (`?tab=`). */
const USERS_VIEWS = ["accounts", "invitations"] as const;
type UsersView = (typeof USERS_VIEWS)[number];

export function UsersPanel({ chrome = "tab" }: { chrome?: "tab" | "screen" }) {
  const { t } = useTranslation("admin");
  const { session } = useSession();

  // Вид и отбор живут в адресе (П1, П30): «Все приглашения» с главной ведёт
  // сюда же ссылкой, а F5 и «Назад» прежде сбрасывали поиск и роль (ADR-0073).
  const [view, setView] = useSectionTab<UsersView>(
    "tab",
    USERS_VIEWS,
    "accounts",
  );
  const [q, setQ] = useSectionQuery();
  const address = useAddressState();
  const patchAddress = useAddressPatch();
  const filter = { q, role: address.role ?? "" };
  const resetFilter = () => patchAddress({ q: undefined, role: undefined });
  // Задержка — чтобы запрос уходил не на каждую букву; отбор всё равно делает
  // сервер (см. `useAdminUsers`).
  const debouncedQuery = useDebouncedValue(filter.q, SEARCH_DELAY_MS);
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
  // Какой сброс подтверждается и для кого. Диалоги стоят один раз под
  // таблицей, а не в каждой строке: пункт меню закрывает меню, и диалог,
  // живущий внутри него, закрылся бы вместе с ним.
  const [confirm, setConfirm] = useState<{
    kind: "password" | "totp";
    user: AdminUser;
  } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const currentUserId = session?.userId ?? null;
  const resetUpdate = update.reset;

  const rows = useMemo(() => users.data?.items ?? [], [users.data]);
  const editing = rows.find((user) => user.id === editingId) ?? null;

  const columns = useMemo<ColumnDef<AdminUser, unknown>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: t("users.columns.name"),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {row.original.full_name}
          </span>
        ),
      },
      {
        accessorKey: "email",
        header: t("users.columns.email"),
        cell: ({ row }) =>
          row.original.email === null ? (
            <span className="text-xs text-muted-foreground">
              {t("users.telegramOnly")}
            </span>
          ) : (
            <span className="text-foreground">{row.original.email}</span>
          ),
      },
      {
        accessorKey: "role",
        header: t("users.columns.role"),
        cell: ({ row }) => (
          <Badge variant="secondary">
            {t(`common:roles.${row.original.role}`)}
          </Badge>
        ),
      },
      {
        accessorKey: "is_active",
        header: t("users.columns.status"),
        cell: ({ row }) => (
          <span
            className={
              row.original.is_active
                ? "inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success"
                : "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
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
          <span className="whitespace-nowrap text-muted-foreground tabular-nums">
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
            // Сбросы — в меню «Ещё», в строке остаётся «Изменить» (правило
            // П31). Три кнопки в ряд делали колонку действий шире половины
            // таблицы, и на ноутбуке она накрывала дату создания.
            <div className="flex items-center gap-1.5 whitespace-nowrap">
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

              {(row.original.email !== null ||
                row.original.totp_resettable) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="min-h-touch min-w-touch"
                      aria-label={t("users.moreAria", {
                        name: row.original.full_name,
                      })}
                    >
                      <Ellipsis aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {row.original.email !== null && (
                      <DropdownMenuItem
                        onSelect={() =>
                          setConfirm({ kind: "password", user: row.original })
                        }
                      >
                        <RotateCcwKey aria-hidden="true" />
                        {t("users.resetPassword")}
                      </DropdownMenuItem>
                    )}
                    {row.original.totp_resettable && (
                      <DropdownMenuItem
                        onSelect={() =>
                          setConfirm({ kind: "totp", user: row.original })
                        }
                      >
                        <KeyRound aria-hidden="true" />
                        {t("users.resetTotp")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ),
      },
    ],
    [t, currentUserId, resetUpdate],
  );

  const inviteButton = (
    <Button type="button" onClick={() => setInviteOpen(true)}>
      <UserPlus aria-hidden="true" />
      {t("users.inviteAction")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-section">
      {chrome === "tab" ? (
        <SubPageHeader title={t("users.title")} actions={inviteButton} />
      ) : (
        // Заголовок даёт экран, а действие уходит в его шапку (П31).
        <PageActions>{inviteButton}</PageActions>
      )}

      {/* Администратор заводит персонал; семью приглашает её врач или диетолог,
          он же становится ведущим специалистом (ADR-0003).

          Панелью, а не блоком над списком: администратор приходит сюда
          управлять учётными записями, а приглашает сотрудника изредка
          (правило П32 канона). */}
      {/* Заголовок называет человека: подтверждается сброс конкретной учётной
          записи, а не абстрактное «вы уверены?». */}
      <ConfirmDialog
        open={confirm?.kind === "password"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t("users.confirmResetPasswordTitle", {
          name: confirm?.user.full_name,
        })}
        description={t("users.confirmResetPasswordBody")}
        confirmLabel={t("users.confirmResetPasswordAction")}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={() => {
          if (confirm === null) return;
          const target = confirm.user;
          resetPassword.mutate(target.id, {
            onSuccess: (data) =>
              setIssued({
                name: target.full_name,
                password: data.temporary_password,
              }),
            onError: (error) =>
              toast.error(
                errorMessageOf(error) ?? t("common:errors.unexpected"),
              ),
          });
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "totp"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t("users.confirmResetTotpTitle", {
          name: confirm?.user.full_name,
        })}
        description={t("users.confirmResetTotpBody")}
        confirmLabel={t("users.confirmResetTotpAction")}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={() => {
          if (confirm === null) return;
          resetTotp.mutate(confirm.user.id, {
            onSuccess: () => toast.success(t("users.totpReset")),
            onError: (error) =>
              toast.error(
                errorMessageOf(error) ?? t("common:errors.unexpected"),
              ),
          });
        }}
      />

      {/* Временный пароль — панелью, которая не закрывается сама: показать его
          второй раз нельзя (в базе только argon2-хэш), а передать владельцу
          администратор должен успеть. */}
      <FormSheet
        closeLabel={t("common:actions.close")}
        open={issued !== null}
        onOpenChange={(open) => {
          if (!open) setIssued(null);
        }}
        title={t("users.temporaryPasswordTitle")}
        description={t("users.temporaryPasswordBody", { name: issued?.name })}
      >
        <div className="flex flex-col gap-section">
          <p className="m-0 rounded-lg border border-border px-3 py-2 text-center font-mono text-lg tracking-wider">
            {issued?.password}
          </p>
          <div className="flex flex-wrap gap-field">
            <Button
              type="button"
              variant="outline"
              className="min-h-touch"
              onClick={() =>
                void copyText(issued?.password ?? "").then((ok) =>
                  ok
                    ? toast.success(t("common:clipboard.copied"))
                    : toast.error(t("common:clipboard.failed")),
                )
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
        closeLabel={t("common:actions.close")}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title={t("invitations:title")}
      >
        <InviteForm roles={STAFF_ROLES} />
      </FormSheet>

      {/* Правка учётной записи — тоже панелью: раньше форма раскрывалась над
          таблицей и отодвигала её вниз ровно в тот момент, когда нужно было
          свериться со списком. */}
      <FormSheet
        closeLabel={t("common:actions.close")}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
        title={t("users.editTitle")}
      >
        {editing !== null && (
          <div className="flex flex-col gap-section">
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
                      toast.success(
                        t("users.saved", { name: saved.full_name }),
                      );
                    },
                  },
                )
              }
            />
            {(editing.sole_patients ?? 0) > 0 && (
              <CareTransferPanel user={editing} />
            )}
          </div>
        )}
      </FormSheet>

      <div>
        <SegmentedControl<UsersView>
          label={t("users.views.label")}
          value={view}
          onChange={setView}
          items={[
            { value: "accounts", label: t("users.views.accounts") },
            { value: "invitations", label: t("users.views.invitations") },
          ]}
        />
      </div>

      {/* Все выданные приглашения, включая выданные врачами семьям: на них
          ведёт «Все приглашения» с главной администратора. Прежде ссылка
          открывала учётные записи, а список прятался в панели «Пригласить». */}
      {view === "invitations" && <InvitationsList />}

      {view === "accounts" && (
        <>
          {/* Панель отбора — блок экрана, поэтому Section со скрытым заголовком
          (правило П23 канона). */}
          <Section
            title={t("users.filters.legend")}
            titleHidden
            density="compact"
            contentClassName="flex-row flex-wrap items-end gap-section"
          >
            <div className="min-w-56 flex-1 sm:max-w-md">
              <Field
                id="users-search"
                width="wide"
                type="search"
                label={t("users.filters.search")}
                value={filter.q}
                onChange={(event) => setQ(event.target.value)}
              />
            </div>
            <SelectField
              id="users-role"
              label={t("users.filters.role")}
              // Ширина по самому длинному варианту — «Администратор»: при
              // узкой «Любая роль» обрезалась до «Любая ро.».
              width="medium"
              value={filter.role}
              onChange={(event) =>
                patchAddress({
                  role: ROLE_OPTIONS.find(
                    (role) => role === event.target.value,
                  ),
                })
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
                onClick={resetFilter}
              >
                {t("users.filters.reset")}
              </Button>
            )}
          </Section>

          {/* Ошибка не прячет уже загруженные строки — правило в AsyncSection. */}
          <AsyncSection
            {...queryState(users)}
            skeleton={<TableSkeleton label={t("users.loading")} columns={6} />}
            error={
              users.isError
                ? {
                    title: t("users.error"),
                    description:
                      errorMessageOf(users.error) ??
                      t("common:errors.unexpected"),
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
                      onClick={resetFilter}
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
                pageStatus: (page, total) =>
                  t("table.pageStatus", { page, total }),
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
        </>
      )}
    </div>
  );
}
