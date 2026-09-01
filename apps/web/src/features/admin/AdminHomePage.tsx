import { AsyncSection, Button, formatOccurredAt, Section } from "@ketocare/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { SectionLink } from "../../components/SectionLink";
import { api, errorMessageOf } from "../../lib/api";
import { ROLES, type Role } from "../auth/roles";
import { LinesSkeleton } from "../doctor/skeletons";
import { EMPTY_AUDIT_FILTERS } from "./auditFilters";
import { useAuditLog } from "./useAuditLog";

/** Сколько последних операций показывать. Это выжимка, а не журнал. */
const RECENT_LIMIT = 5;

/**
 * Состояние системы одним запросом.
 *
 * Считает база. Учётные записи по ролям экран пересчитывал сам по первым
 * двумстам строкам списка — на установке с сотней семей число переставало быть
 * правдой ровно тогда, когда счётчик и нужен.
 */
function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/admin/overview", {});
      if (error || !data) throw error ?? new Error("Empty overview response");
      return data;
    },
  });
}

/**
 * Главная администратора — «состояние системы» (`docs/DESIGN_PROPOSAL.md`).
 *
 * Вход администратора вёл сразу в список учётных записей — один из четырёх
 * разделов, выбранный лишь тем, что он первый в меню.
 *
 * Клинических данных здесь нет и быть не может: администратор к ним доступа не
 * имеет (правило 5 CLAUDE.md). Поэтому дашборд отвечает про учётки, справочник
 * продуктов и журнал операций — и ни слова про пациентов.
 *
 * Все счётчики считает база (`GET /admin/overview`). Раньше учётные записи по
 * ролям экран пересчитывал сам по первым двумстам строкам списка: на установке
 * с сотней семей число переставало быть правдой ровно тогда, когда счётчик и
 * нужен. Показатель, посчитанный неверно, хуже отсутствующего — по нему
 * принимают решения.
 *
 * «Результата последнего импорта» здесь по-прежнему нет: он лежит в журнале
 * аудита, и отдельный блок дублировал бы последние операции, которые тут же
 * рядом.
 */
export function AdminHomePage() {
  const { t } = useTranslation("admin");

  const overview = useAdminOverview();
  const recent = useAuditLog(EMPTY_AUDIT_FILTERS, 0, true);

  const byRole = useMemo(() => {
    const counts = new Map<Role, { active: number; inactive: number }>();
    for (const role of ROLES) counts.set(role, { active: 0, inactive: 0 });
    for (const row of overview.data?.users ?? []) {
      counts.set(row.role as Role, {
        active: row.active,
        inactive: row.inactive,
      });
    }
    return counts;
  }, [overview.data]);

  const staleHref = staleVerificationDate(overview.data?.stale_after_days);

  const recentRows = (recent.data?.items ?? []).slice(0, RECENT_LIMIT);

  return (
    <PageLayout title={t("home.title")} intro={t("home.intro")}>
      <Section
        title={t("home.accounts.title")}
        description={t("home.accounts.intro")}
        density="compact"
        action={
          <Button asChild variant="outline">
            <SectionLink section="users">
              {t("home.accounts.toList")}
            </SectionLink>
          </Button>
        }
      >
        <AsyncSection
          loading={overview.isPending}
          skeleton={
            <LinesSkeleton label={t("home.accounts.loading")} lines={4} />
          }
          error={
            overview.isError
              ? {
                  title: t("home.accounts.loadError"),
                  description:
                    errorMessageOf(overview.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void overview.refetch()}
          isEmpty={false}
          empty={null}
        >
          <dl className="m-0 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:justify-start">
            {ROLES.map((role) => {
              const bucket = byRole.get(role);
              return (
                <div key={role} className="contents">
                  <dt className="text-muted-foreground">
                    {t(`common:roles.${role}`)}
                  </dt>
                  <dd className="m-0 tabular-nums">
                    {/* Отключённые названы отдельно, а не спрятаны в общем
                        числе: «шесть врачей», из которых двое без доступа, —
                        это не шесть врачей. */}
                    {bucket?.inactive
                      ? t("home.accounts.withInactive", {
                          active: bucket.active,
                          inactive: bucket.inactive,
                        })
                      : (bucket?.active ?? 0)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </AsyncSection>
      </Section>

      <Section
        title={t("home.products.title")}
        description={t("home.products.intro")}
        density="compact"
        action={
          <Button asChild variant="outline">
            <SectionLink section="products">
              {t("home.products.toList")}
            </SectionLink>
          </Button>
        }
      >
        <AsyncSection
          loading={overview.isPending}
          skeleton={
            <LinesSkeleton label={t("home.products.loading")} lines={1} />
          }
          error={
            overview.isError
              ? {
                  title: t("home.products.loadError"),
                  description:
                    errorMessageOf(overview.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void overview.refetch()}
          isEmpty={false}
          empty={null}
        >
          <div className="flex flex-col gap-field">
            <p className="m-0 tabular-nums">
              {t("home.products.total", {
                count: overview.data?.products_total ?? 0,
              })}
              {" · "}
              {t("home.products.active", {
                count: overview.data?.products_active ?? 0,
              })}
            </p>

            {/* «Давно не сверялось» — эксплуатационный порог, а не оценка
                правильности значений: он говорит «пора перепроверить». Число
                со ссылкой на сами позиции: счётчик без перехода к ним был бы
                тупиком. */}
            {(overview.data?.products_stale ?? 0) > 0 && (
              <p className="m-0">
                <SectionLink
                  section="products"
                  query={staleHref}
                  className="underline"
                >
                  {t("home.products.stale", {
                    count: overview.data?.products_stale ?? 0,
                    days: overview.data?.stale_after_days ?? 0,
                  })}
                </SectionLink>
              </p>
            )}
          </div>
        </AsyncSection>
      </Section>

      <Section
        title={t("home.invitations.title")}
        description={t("home.invitations.intro")}
        density="compact"
        action={
          <Button asChild variant="outline">
            <SectionLink section="users">
              {t("home.invitations.toList")}
            </SectionLink>
          </Button>
        }
      >
        <AsyncSection
          loading={overview.isPending}
          skeleton={
            <LinesSkeleton label={t("home.invitations.loading")} lines={1} />
          }
          error={
            overview.isError
              ? {
                  title: t("home.invitations.loadError"),
                  description:
                    errorMessageOf(overview.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void overview.refetch()}
          isEmpty={false}
          empty={null}
        >
          {/* Забытое приглашение — открытая дверь в кабинет с данными ребёнка:
              пока оно живо, по ссылке заводится учётная запись. */}
          <p className="m-0 tabular-nums">
            {t("home.invitations.pending", {
              count: overview.data?.invitations_pending ?? 0,
            })}
            {(overview.data?.invitations_expired ?? 0) > 0 && (
              <>
                {" · "}
                {t("home.invitations.expired", {
                  count: overview.data?.invitations_expired ?? 0,
                })}
              </>
            )}
          </p>
        </AsyncSection>
      </Section>

      <Section
        title={t("home.audit.title")}
        description={t("home.audit.intro")}
        density="compact"
        action={
          <Button asChild variant="outline">
            <SectionLink section="audit">{t("home.audit.toList")}</SectionLink>
          </Button>
        }
      >
        <AsyncSection
          loading={recent.isPending}
          skeleton={<LinesSkeleton label={t("home.audit.loading")} lines={5} />}
          error={
            recent.isError
              ? {
                  title: t("home.audit.loadError"),
                  description:
                    errorMessageOf(recent.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void recent.refetch()}
          isEmpty={recentRows.length === 0}
          empty={
            <p className="m-0 text-sm text-muted-foreground">
              {t("home.audit.empty")}
            </p>
          }
        >
          <ul className="m-0 flex list-none flex-col gap-field p-0 text-sm">
            {recentRows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-3">
                <time
                  dateTime={row.created_at}
                  className="text-muted-foreground tabular-nums"
                >
                  {formatOccurredAt(new Date(row.created_at))}
                </time>
                {/* Значение из справочника, а не сырой код: `defaultValue`
                    оставляет код, если действие в словарь ещё не занесли. */}
                <span className="font-medium">
                  {t(`audit.actions.${row.action}`, {
                    defaultValue: row.action,
                  })}
                </span>
                <span className="text-muted-foreground">
                  {t(`audit.entities.${row.entity}`, {
                    defaultValue: row.entity,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </AsyncSection>
      </Section>
    </PageLayout>
  );
}

/**
 * Дата, раньше которой сверка считается устаревшей.
 *
 * Порог задаёт сервер (`stale_after_days`), а не экран: иначе ссылка «показать
 * их» открывала бы список по другому правилу, чем счётчик рядом.
 */
function staleVerificationDate(days: number | undefined): string | undefined {
  if (days === undefined) return undefined;
  const edge = new Date();
  edge.setDate(edge.getDate() - days);
  return edge.toISOString().slice(0, 10);
}
