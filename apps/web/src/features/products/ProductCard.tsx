import {
  AsyncSection,
  Badge,
  Button,
  MacroBar,
  Section,
  Skeleton,
  WarningBanner,
} from "@ketocare/ui";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { SectionLink } from "../../components/SectionLink";
import { api, errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { ProductRevisions } from "./ProductRevisions";
import { canSeeProductHistory } from "./types";

/**
 * Карточка позиции справочника — по адресу (`?item=<id>`).
 *
 * Карточки не было ни у одной роли: справочник существовал только как таблица,
 * а происхождение значений (`source`, `source_version`, `verified_at`) видел
 * лишь администратор в форме правки. Между тем это и есть паспорт записи:
 * откуда взяты числа, какая это версия базы и когда их сверяли. По ним
 * считается еда ребёнку, и проверить их должно быть можно, не открывая
 * редактор.
 *
 * По адресу — чтобы ссылку на позицию можно было переслать и открыть заново
 * (правило П1 канона): «посмотри вот этот продукт» иначе передаётся только
 * словами.
 */
export function ProductCard({
  productId,
  onBack,
}: {
  productId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("products");
  const { session } = useSession();

  const product = useQuery({
    queryKey: ["products", "detail", productId],
    // `retry: false` — несуществующий идентификатор из чужой или устаревшей
    // ссылки повтором не оживёт.
    retry: false,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/products/{product_id}", {
        params: { path: { product_id: productId } },
      });
      if (error || !data) throw error ?? new Error("Empty product response");
      return data;
    },
  });

  const data = product.data;

  return (
    <PageLayout
      title={data?.name_ru ?? t("card.titleFallback")}
      onBack={onBack}
      backLabel={t("card.back")}
      actions={
        data && (
          // Справочник без выхода в расчёт — тупик: продукт найден, а сделать
          // с ним нечего.
          <Button asChild className="min-h-touch">
            <SectionLink section="calculator" item={data.id}>
              <Calculator aria-hidden="true" />
              {t("actions.toCalculator")}
            </SectionLink>
          </Button>
        )
      }
    >
      <AsyncSection
        loading={product.isLoading}
        skeleton={
          <div role="status" className="flex flex-col gap-block">
            <span className="sr-only">{t("card.loading")}</span>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-24 w-full max-w-xl" />
          </div>
        }
        error={
          product.isError
            ? {
                title: t("card.error"),
                description:
                  errorMessageOf(product.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void product.refetch()}
        isEmpty={data === undefined}
        empty={null}
      >
        {data && (
          <>
            {!data.is_active && (
              <WarningBanner level="warning" title={t("card.withdrawnTitle")}>
                {t("card.withdrawnBody")}
              </WarningBanner>
            )}

            <Section title={t("card.nutrition")} description={t("card.per100")}>
              <p className="m-0 text-page-title font-semibold tabular-nums">
                {t("card.kcal", { value: data.kcal_100g.toFixed(0) })}
              </p>
              <MacroBar
                fatG={data.fat_100g}
                proteinG={data.protein_100g}
                carbsG={data.carbs_100g}
              />
              <p className="m-0 text-sm text-muted-foreground tabular-nums">
                {t("card.fiber", { value: data.fiber_100g })}
              </p>
            </Section>

            {/* Паспорт записи. Раньше эти три поля видел только администратор в
                форме правки — при том что именно они отвечают на вопрос «можно
                ли доверять этим числам». */}
            <Section title={t("card.passport")} density="compact">
              <dl className="m-0 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:justify-start">
                <dt className="text-muted-foreground">
                  {t("card.fields.source")}
                </dt>
                <dd className="m-0">{data.source}</dd>

                <dt className="text-muted-foreground">
                  {t("card.fields.sourceVersion")}
                </dt>
                <dd className="m-0">{data.source_version}</dd>

                <dt className="text-muted-foreground">
                  {t("card.fields.verifiedAt")}
                </dt>
                <dd className="m-0 tabular-nums">{data.verified_at}</dd>

                <dt className="text-muted-foreground">
                  {t("card.fields.state")}
                </dt>
                <dd className="m-0">
                  <Badge variant={data.is_active ? "secondary" : "outline"}>
                    {data.is_active
                      ? t("revisions.active")
                      : t("revisions.withdrawn")}
                  </Badge>
                </dd>
              </dl>
            </Section>

            {/* Кто и что менял — только специалистам: имена сотрудников рядом с
                правками семье не нужны ни для чего, и сервер их ей не отдаёт. */}
            {canSeeProductHistory(session?.role) && (
              <ProductRevisions productId={data.id} />
            )}
          </>
        )}
      </AsyncSection>
    </PageLayout>
  );
}
