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
import { useAdminUsers } from "./useAdminUsers";
import { useAuditLog } from "./useAuditLog";

/** Сколько последних операций показывать. Это выжимка, а не журнал. */
const RECENT_LIMIT = 5;

/**
 * Число позиций в справочнике продуктов.
 *
 * Берётся из `total` ответа поиска, а не подсчётом на клиенте: страницы хватает
 * одной, а тянуть тысячи карточек ради одного числа незачем.
 */
function useProductsCount() {
  return useQuery({
    queryKey: ["admin", "products", "count"],
    queryFn: async (): Promise<number> => {
      const { data, error } = await api.GET("/api/v1/products", {
        params: { query: { limit: 1, offset: 0 } },
      });
      if (error || !data) throw error ?? new Error("Empty products response");
      return data.total;
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
 * Двух показателей из предложения нет, потому что за ними нет ручек:
 * «невостребованные приглашения» — списка приглашений в API не существует
 * вовсе, а «продукты без подтверждённого источника» и «результат последнего
 * импорта» потребовали бы либо агрегата на сервере, либо выгрузки всего
 * справочника на клиент ради двух чисел. Показатель, посчитанный неверно,
 * хуже отсутствующего: по нему принимают решения.
 */
export function AdminHomePage() {
  const { t } = useTranslation("admin");

  const users = useAdminUsers();
  const products = useProductsCount();
  const recent = useAuditLog(EMPTY_AUDIT_FILTERS, 0, true);

  const byRole = useMemo(() => {
    const counts = new Map<Role, { active: number; inactive: number }>();
    for (const role of ROLES) counts.set(role, { active: 0, inactive: 0 });

    for (const user of users.data?.items ?? []) {
      const bucket = counts.get(user.role as Role);
      if (bucket === undefined) continue;
      if (user.is_active) bucket.active += 1;
      else bucket.inactive += 1;
    }
    return counts;
  }, [users.data]);

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
          loading={users.isPending}
          skeleton={
            <LinesSkeleton label={t("home.accounts.loading")} lines={4} />
          }
          error={
            users.isError
              ? {
                  title: t("home.accounts.loadError"),
                  description:
                    errorMessageOf(users.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void users.refetch()}
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
          loading={products.isPending}
          skeleton={
            <LinesSkeleton label={t("home.products.loading")} lines={1} />
          }
          error={
            products.isError
              ? {
                  title: t("home.products.loadError"),
                  description:
                    errorMessageOf(products.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void products.refetch()}
          isEmpty={false}
          empty={null}
        >
          <p className="m-0 tabular-nums">
            {t("home.products.total", { count: products.data ?? 0 })}
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
