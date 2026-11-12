import {
  AsyncSection,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  formatOccurredAt,
  SegmentedControl,
  toast,
} from "@ketocare/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Inbox, Trash2, Undo2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SubPageHeader } from "../../components/SubPageHeader";
import { api, errorMessageOf } from "../../lib/api";
import { useSectionTab } from "../../routes/useSectionTab";
import { TableSkeleton } from "./TableSkeleton";
import { MAX_PAGE_SIZE, type Lead } from "./types";
import { queryState } from "../../lib/queryState";

const LEADS_KEY = ["admin", "leads"] as const;

/**
 * Отбор заявок (`?tab=`). По умолчанию — новые: список открывают, чтобы
 * ответить тем, кому ещё не ответили (ADR-0072).
 */
const LEAD_VIEWS = ["new", "processed", "all"] as const;
type LeadView = (typeof LEAD_VIEWS)[number];

/** Языки посадочной страницы (`LeadLocale` в API) — названием, а не кодом. */
const KNOWN_LOCALES = ["ru", "uz-Latn-UZ", "en"] as const;

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
  const [view, setView] = useSectionTab<LeadView>("tab", LEAD_VIEWS, "new");

  const leads = useQuery({
    queryKey: [...LEADS_KEY, view],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/leads", {
        params: {
          query: {
            limit: MAX_PAGE_SIZE,
            offset: 0,
            status: view === "all" ? undefined : view,
          },
        },
      });
      if (error || !data) throw error ?? new Error("Empty leads response");
      return data;
    },
  });

  const mark = useMutation({
    mutationFn: async (input: { leadId: string; processed: boolean }) => {
      const { data, error } = await api.PATCH("/api/v1/leads/{lead_id}", {
        params: { path: { lead_id: input.leadId } },
        body: { processed: input.processed },
      });
      if (error || !data) throw error ?? new Error("Empty lead response");
      return data;
    },
    onSuccess: async (lead) => {
      toast.success(
        t(lead.processed_at ? "leads.markedProcessed" : "leads.markedNew", {
          email: lead.email,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: LEADS_KEY });
    },
    onError: (error) =>
      toast.error(errorMessageOf(error) ?? t("common:errors.unexpected")),
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
      {
        accessorKey: "locale",
        header: t("leads.columns.locale"),
        // Название языка на нём самом, как в переключателе сайта: «uz-Latn-UZ»
        // в таблице читался как служебная запись. Незнакомый код — как есть.
        cell: ({ row }) =>
          (KNOWN_LOCALES as readonly string[]).includes(row.original.locale)
            ? t(`leads.locales.${row.original.locale}`)
            : row.original.locale,
      },
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
        accessorKey: "processed_at",
        header: t("leads.columns.status"),
        cell: ({ row }) =>
          row.original.processed_at ? (
            <span className="flex flex-col gap-0.5">
              <Badge variant="secondary" className="self-start">
                {t("leads.status.processed")}
              </Badge>
              <time
                dateTime={row.original.processed_at}
                className="text-xs text-muted-foreground tabular-nums"
              >
                {formatOccurredAt(new Date(row.original.processed_at))}
              </time>
            </span>
          ) : (
            <Badge>{t("leads.status.new")}</Badge>
          ),
      },
      {
        id: "actions",
        header: t("leads.columns.actions"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-touch"
              disabled={mark.isPending}
              aria-label={t(
                row.original.processed_at
                  ? "leads.markNewAria"
                  : "leads.markProcessedAria",
                { email: row.original.email },
              )}
              onClick={() =>
                mark.mutate({
                  leadId: row.original.id,
                  processed: !row.original.processed_at,
                })
              }
            >
              {row.original.processed_at ? (
                <Undo2 aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              {t(
                row.original.processed_at
                  ? "leads.markNew"
                  : "leads.markProcessed",
              )}
            </Button>
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
              title={t("leads.confirmRemoveTitle", {
                email: row.original.email,
              })}
              description={t("leads.confirmRemoveBody")}
              confirmLabel={t("leads.confirmRemoveAction")}
              cancelLabel={t("common:actions.cancel")}
              onConfirm={() => remove.mutate(row.original.id)}
            />
          </div>
        ),
      },
    ],
    [t, remove, mark],
  );

  const items = leads.data?.items ?? [];

  return (
    <>
      {/* На самостоятельном экране заголовок даёт `PageLayout`: второй такой
          же был бы дублем (правило П23 канона). */}
      {chrome === "tab" && (
        <SubPageHeader title={t("leads.title")} intro={t("leads.intro")} />
      )}

      <div>
        <SegmentedControl<LeadView>
          label={t("leads.views.label")}
          value={view}
          onChange={setView}
          items={[
            { value: "new", label: t("leads.views.new") },
            { value: "processed", label: t("leads.views.processed") },
            { value: "all", label: t("leads.views.all") },
          ]}
        />
      </div>

      <AsyncSection
        {...queryState(leads)}
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
          view === "new" ? (
            // Новых нет — не то же самое, что заявок нет вовсе.
            <EmptyState icon={Inbox} title={t("leads.emptyNew")} />
          ) : (
            <EmptyState
              icon={Inbox}
              title={t("leads.empty")}
              description={t("leads.emptyDescription")}
            />
          )
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
