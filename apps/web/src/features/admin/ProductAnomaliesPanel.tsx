import { AsyncSection, EmptyState, Section, Skeleton } from "@ketocare/ui";
import { useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { SectionLink } from "../../components/SectionLink";

type Anomalies = components["schemas"]["ProductWithAnomalies"];
type Anomaly = components["schemas"]["ProductAnomalyRead"];

/**
 * Пояснение к находке: класс и числа приходят с сервера, фраза собирается из
 * словаря (правило 8 CLAUDE.md).
 */
function detailOf(t: TFunction<"admin">, item: Anomaly): string {
  return t(`products.anomalies.detail.${item.kind}`, {
    ...item.values,
    field: item.field
      ? t(`products.anomalies.field.${item.field}`, {
          defaultValue: item.field,
        })
      : "",
    defaultValue: "",
  });
}

const PAGE_SIZE = 50;

function useProductAnomalies() {
  return useQuery({
    queryKey: ["admin", "product-anomalies"],
    queryFn: async (): Promise<{ items: Anomalies[]; total: number }> => {
      const { data, error } = await api.GET("/api/v1/products/anomalies", {
        params: { query: { limit: PAGE_SIZE, offset: 0 } },
      });
      if (error || !data) throw error ?? new Error("Empty anomalies response");
      return data;
    },
  });
}

/**
 * Продукты, значения которых не сходятся между собой (раздел 10.1 ТЗ).
 *
 * Считает арифметика, а не модель: обе проверки, которые называет ТЗ, — счёт, а
 * счёт, отданный модели, становится непроверяемым (ADR-0024). Границы те же,
 * что у импорта, — иначе продукт, который импорт сегодня не пропустил бы,
 * спокойно жил бы в базе.
 *
 * Панель ничего не исправляет сама: значения продукта — это то, по чему считают
 * меню ребёнка, и «починить» их автоматически нельзя. Каждая строка ведёт в
 * карточку продукта, где человек сверяет их с источником.
 */
export function ProductAnomaliesPanel() {
  const { t } = useTranslation("admin");
  const anomalies = useProductAnomalies();
  const rows = anomalies.data?.items ?? [];
  const total = anomalies.data?.total ?? 0;

  return (
    <Section
      title={t("products.anomalies.title")}
      density="compact"
      description={t("products.anomalies.description")}
    >
      <AsyncSection
        loading={anomalies.isLoading}
        skeleton={<Skeleton className="h-24 w-full rounded-xl" />}
        error={
          anomalies.isError ? { title: t("products.anomalies.failed") } : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void anomalies.refetch()}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title={t("products.anomalies.empty.title")}
            description={t("products.anomalies.empty.description")}
          />
        }
      >
        <>
          {total > rows.length && (
            <p className="m-0 text-sm text-muted-foreground">
              {t("products.anomalies.more", {
                shown: rows.length,
                total,
              })}
            </p>
          )}
          <ul className="m-0 flex list-none flex-col gap-block p-0">
            {rows.map((row) => (
              <li key={row.product_id} className="flex flex-col gap-field">
                <p className="m-0 flex flex-wrap items-baseline gap-field">
                  <SectionLink
                    section="products"
                    item={row.product_id}
                    className="font-medium"
                  >
                    {row.name_ru}
                  </SectionLink>
                  {/* Выведенные позиции проверяются тоже: в меню их не
                      предлагают, но в сохранённых блюдах они остаются. Без
                      пометки администратор не отличит их в списке. */}
                  {!row.is_active && (
                    <span className="text-sm text-muted-foreground">
                      {t("products.anomalies.inactive")}
                    </span>
                  )}
                </p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {row.anomalies.map((item, index) => (
                    <li
                      key={`${item.kind}-${index}`}
                      className="text-sm text-muted-foreground"
                    >
                      <span className="text-warning">
                        {t(`products.anomalies.kind.${item.kind}`, {
                          defaultValue: t("products.anomalies.kind.other"),
                        })}
                      </span>
                      {" — "}
                      {/* Фраза собирается здесь из чисел: сервер отдаёт класс и
                          значения, а текст живёт в словаре (правило 8). */}
                      {detailOf(t, item)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      </AsyncSection>
    </Section>
  );
}
