import {
  AsyncSection,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  formatOccurredAt,
  toast,
} from "@ketocare/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Inbox, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SubPageHeader } from "../../components/SubPageHeader";
import { api, errorMessageOf } from "../../lib/api";
import { TableSkeleton } from "./TableSkeleton";
import { MAX_PAGE_SIZE, type Lead } from "./types";

const LEADS_KEY = ["admin", "leads"] as const;

/**
 * Заявки с посадочной страницы (ADR-0012).
 *
 * Ручки существовали с самого начала, а экрана не было: заявка ложилась в
 * таблицу, которую в кабинете не видно, и человек, оставивший почту, не
 * получал ничего. Посадочная при этом обещает «напишем на …» — обещание,
 * которое некому выполнить, если список никто не открывает.
 *
 * Чтение списка пишется в журнал: пара «почта + `audience=family`» сама по
 * себе означает, что в семье ребёнок с лекарственно-резистентной эпилепсией,
 * и просмотр всей такой базы ближе к выгрузке данных, чем к чтению
 * справочника. Запись делает сервер.
 *
 * Удаление физическое: правило 4 защищает историю болезни, а здесь контакт
 * человека, попросившего себя убрать, — «мягко удалённый» контакт эту просьбу
 * не выполняет.
 */
export function LeadsPanel({ chrome = "tab" }: { chrome?: "tab" | "screen" }) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();

  const leads = useQuery({
    queryKey: LEADS_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/leads", {
        params: { query: { limit: MAX_PAGE_SIZE, offset: 0 } },
      });
      if (error || !data) throw error ?? new Error("Empty leads response");
      return data;
    },
  });

  const remove = useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await api.DELETE("/api/v1/leads/{lead_id}", {
        params: { path: { lead_id: leadId } },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(t("leads.removed"));
      await queryClient.invalidateQueries({ queryKey: LEADS_KEY });
    },
    onError: (error) =>
      toast.error(errorMessageOf(error) ?? t("common:errors.unexpected")),
  });

  const columns = useMemo<ColumnDef<Lead, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: t("leads.columns.email"),
        // Почта — ссылка: ответить на заявку это и есть работа с ней, а
        // переписывание адреса руками добавляет только опечатки.
        cell: ({ row }) => (
          <a
            href={`mailto:${row.original.email}`}
            className="underline-offset-2 hover:underline"
          >
            {row.original.email}
          </a>
        ),
      },
      {
        accessorKey: "audience",
        header: t("leads.columns.audience"),
        cell: ({ row }) => t(`leads.audience.${row.original.audience}`),
      },
      { accessorKey: "locale", header: t("leads.columns.locale") },
      {
        accessorKey: "created_at",
        header: t("leads.columns.createdAt"),
        cell: ({ row }) => (
          <time dateTime={row.original.created_at} className="tabular-nums">
            {formatOccurredAt(new Date(row.original.created_at))}
          </time>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <ConfirmDialog
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-touch text-destructive"
                aria-label={t("leads.removeAria", {
                  email: row.original.email,
                })}
              >
                <Trash2 aria-hidden="true" />
                {t("leads.remove")}
              </Button>
            }
            title={t("leads.confirmRemoveTitle", { email: row.original.email })}
            description={t("leads.confirmRemoveBody")}
            confirmLabel={t("leads.confirmRemoveAction")}
            cancelLabel={t("common:actions.cancel")}
            onConfirm={() => remove.mutate(row.original.id)}
          />
        ),
      },
    ],
    [t, remove],
  );

  const items = leads.data?.items ?? [];

  return (
    <>
      {/* На самостоятельном экране заголовок даёт `PageLayout`: второй такой
          же был бы дублем (правило П23 канона). */}
      {chrome === "tab" && (
        <SubPageHeader title={t("leads.title")} intro={t("leads.intro")} />
      )}

      <AsyncSection
        loading={leads.isPending}
        skeleton={<TableSkeleton label={t("leads.loading")} columns={5} />}
        error={
          leads.isError
            ? {
                title: t("leads.loadError"),
                description:
                  errorMessageOf(leads.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void leads.refetch()}
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={Inbox}
            title={t("leads.empty")}
            description={t("leads.emptyDescription")}
          />
        }
      >
        <DataTable
          columns={columns}
          data={items}
          caption={t("leads.caption")}
          emptyState={null}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      </AsyncSection>
    </>
  );
}
