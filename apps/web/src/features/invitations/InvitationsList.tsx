import {
  AsyncSection,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { MailPlus } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import {
  useInvitations,
  useRevokeInvitationMutation,
  type Invitation,
} from "./useInvitations";

/**
 * Выданные приглашения.
 *
 * Ссылка показывается один раз и не восстанавливается: вопрос «я уже приглашал
 * эту семью?» оставался без ответа, срок действия был виден только в момент
 * выдачи, а отозвать ошибочное приглашение было нечем — оставалось ждать
 * неделю, пока оно истечёт.
 *
 * Токена здесь нет и не будет: список, показывающий ссылку повторно, сам
 * становится способом войти чужой учётной записью. Ошиблись адресом — отзыв и
 * новое приглашение.
 */
export function InvitationsList() {
  const { t } = useTranslation("invitations");
  const invitations = useInvitations();

  const rows = useMemo(() => invitations.data?.items ?? [], [invitations.data]);

  const columns = useMemo<ColumnDef<Invitation, unknown>[]>(
    () => [
      { accessorKey: "email", header: t("list.columns.email") },
      {
        accessorKey: "role",
        header: t("list.columns.role"),
        cell: ({ row }) => t(`common:roles.${row.original.role}`),
      },
      {
        accessorKey: "status",
        header: t("list.columns.status"),
        cell: ({ row }) => <StatusBadge invitation={row.original} />,
      },
      {
        accessorKey: "expires_at",
        header: t("list.columns.expires"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.expires_at.slice(0, 10)}
          </span>
        ),
      },
      {
        accessorKey: "invited_by_name",
        header: t("list.columns.invitedBy"),
        cell: ({ row }) => row.original.invited_by_name ?? "—",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => <RevokeAction invitation={row.original} />,
      },
    ],
    [t],
  );

  return (
    <AsyncSection
      loading={invitations.isPending}
      skeleton={null}
      error={
        invitations.isError
          ? {
              title: t("list.loadError"),
              description:
                errorMessageOf(invitations.error) ??
                t("common:errors.unexpected"),
            }
          : null
      }
      retryLabel={t("common:actions.retry")}
      onRetry={() => void invitations.refetch()}
      isEmpty={rows.length === 0}
      empty={
        <EmptyState
          icon={MailPlus}
          title={t("list.empty.title")}
          description={t("list.empty.description")}
        />
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        caption={t("list.caption")}
        emptyState={null}
        labels={{
          previousPage: t("list.previousPage"),
          nextPage: t("list.nextPage"),
          pageStatus: (page, total) => t("list.pageStatus", { page, total }),
        }}
      />
    </AsyncSection>
  );
}

/** Состояние одним словом; цвет — не единственный носитель смысла (правило П19). */
function StatusBadge({ invitation }: { invitation: Invitation }) {
  const { t } = useTranslation("invitations");

  const variant =
    invitation.status === "accepted"
      ? "secondary"
      : invitation.status === "pending"
        ? "default"
        : "outline";

  return (
    <Badge variant={variant}>{t(`list.status.${invitation.status}`)}</Badge>
  );
}

/**
 * Отзыв предлагается только там, где он что-то меняет.
 *
 * У принятого приглашения учётная запись уже создана, у истёкшего и отозванного
 * ссылка и так не работает: кнопка обещала бы действие, которого нет
 * (правило П3 канона).
 */
function RevokeAction({ invitation }: { invitation: Invitation }) {
  const { t } = useTranslation("invitations");
  const revoke = useRevokeInvitationMutation();

  if (invitation.status !== "pending") return null;

  return (
    <ConfirmDialog
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-touch text-destructive"
          disabled={revoke.isPending}
        >
          {t("list.revoke")}
        </Button>
      }
      title={t("list.confirmRevoke.title", { email: invitation.email })}
      description={t("list.confirmRevoke.body")}
      confirmLabel={t("list.confirmRevoke.confirm")}
      cancelLabel={t("common:actions.cancel")}
      onConfirm={() =>
        revoke.mutate(invitation.id, {
          onSuccess: () => toast.success(t("list.revoked")),
          onError: (error) =>
            toast.error(errorMessageOf(error) ?? t("common:errors.unexpected")),
        })
      }
    />
  );
}
