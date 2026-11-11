import {
  formatMass,
  formatPerGram,
  AsyncSection,
  Badge,
  Button,
  EmptyState,
  Fact,
  FactList,
  Section,
  Skeleton,
  WarningBanner,
} from "@ketocare/ui";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { SectionLink } from "../../components/SectionLink";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { formatIsoDate } from "../doctor/dates";
import { ProductRevisions } from "./ProductRevisions";
import {
  fetchProductDetail,
  productDetailKey,
  type ProductDetail,
} from "./useProductDetail";
import { canSeeProductHistory } from "./types";
import { queryState } from "../../lib/queryState";

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
    queryKey: productDetailKey(productId),
    // `retry: false` — несуществующий идентификатор из чужой или устаревшей
    // ссылки повтором не оживёт.
    retry: false,
    // Запрос — общий с карточкой рецепта и формой: у общего ключа обязано быть
    // общее значение. Пока тело было своим у каждого, положенный соседом
    // `null` («такого продукта нет») читался здесь как «данных нет вовсе», и
    // карточка рисовалась пустой — без ошибки и без «не найден».
    queryFn: () => fetchProductDetail(productId),
  });

  const data = product.data ?? undefined;

  // Происхождение отдельного числа (ADR-0067). Нет пометки — число подписано
  // источником всей строки, он стоит в паспорте ниже, и повторять его у
  // каждого числа незачем.
  const sourceNote = (
    detail: ProductDetail,
    field: ValueField,
  ): string | null => {
    const source = detail.value_sources?.[field];
    if (!source) return null;
    if (source.kind === "product") {
      return source.label
        ? t("card.valueSource.standard", { name: source.label })
        : t("card.valueSource.standardUnknown");
    }
    const date = source.at ? formatIsoDate(source.at.slice(0, 10)) : null;
    return t("card.valueSource.manual", {
      name: source.label ?? t("card.valueSource.unknownAuthor"),
      date: date ?? "",
    });
  };

  // Прочерк в источнике (ADR-0067): в числе лежит 0, но это «нет данных», и
  // напечатать ноль значило бы утверждать то, чего источник не утверждал.
  const valueOf = (detail: ProductDetail, field: ValueField): string =>
    detail.unknown_fields?.includes(field)
      ? t("card.noData")
      : formatPerGram(detail[field]);

  return (
    <PageLayout
      title={data?.name_ru ?? t("card.titleFallback")}
      onBack={onBack}
      backLabel={t("card.back")}
      actions={
        // Прочерк в жирах, белках или углеводах (ADR-0067): сервер такой
        // продукт в расчёт не пустит, и кнопка вела бы в отказ.
        data &&
        !ENERGY_FIELDS.some((field) =>
          data.unknown_fields?.includes(field),
        ) && (
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
        {...queryState(product)}
        skeleton={
          <div role="status" className="flex flex-col gap-section">
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
        // `null` — справочник ответил «такого продукта нет»: ссылка устарела
        // или продукт стёрт. Это ответ, и сказать его надо словами.
        isEmpty={product.data === null}
        empty={<EmptyState title={t("card.notFound")} />}
      >
        {data && (
          <>
            {!data.is_active && (
              <WarningBanner level="warning" title={t("card.withdrawnTitle")}>
                {t("card.withdrawnBody")}
              </WarningBanner>
            )}

            {/* Приправа (ADR-0054): числа на 100 г показываются — они правда
                такие, — но в расчёт блюда не идут. Сказать это надо там, где
                на них смотрят. */}
            {!data.counts_in_calculation && (
              <WarningBanner level="info" title={t("card.uncountedTitle")}>
                {t("card.uncountedBody")}
              </WarningBanner>
            )}

            {/* На 1 г, как вводит диетолог (ADR-0065); хранится на 100 г. */}
            <Section
              title={t("card.nutrition")}
              description={t("card.perGram")}
            >
              <FactList>
                <Fact
                  label={t("card.perGramRows.kcal")}
                  value={
                    <ValueWithSource
                      value={valueOf(data, "kcal_100g")}
                      source={sourceNote(data, "kcal_100g")}
                    />
                  }
                />
                <Fact
                  label={t("card.perGramRows.fat")}
                  value={
                    <ValueWithSource
                      value={valueOf(data, "fat_100g")}
                      source={sourceNote(data, "fat_100g")}
                    />
                  }
                />
                <Fact
                  label={t("card.perGramRows.protein")}
                  value={
                    <ValueWithSource
                      value={valueOf(data, "protein_100g")}
                      source={sourceNote(data, "protein_100g")}
                    />
                  }
                />
                <Fact
                  label={t("card.perGramRows.carbs")}
                  value={
                    <ValueWithSource
                      value={valueOf(data, "carbs_100g")}
                      source={sourceNote(data, "carbs_100g")}
                    />
                  }
                />
                <Fact
                  label={t("card.perGramRows.fiber")}
                  value={
                    <ValueWithSource
                      value={
                        data.fiber_known ||
                        data.unknown_fields?.includes("fiber_100g")
                          ? valueOf(data, "fiber_100g")
                          : t("card.fiberUnknown")
                      }
                      source={sourceNote(data, "fiber_100g")}
                    />
                  }
                />
              </FactList>
              {/* Отходы при обработке — как их приводит источник; числа выше
                  на съедобную часть. */}
              {data.waste_pct != null && (
                <p className="text-muted-foreground">
                  {t("card.waste", { value: formatMass(data.waste_pct) })}
                </p>
              )}
            </Section>

            {/* Паспорт записи. Раньше эти три поля видел только администратор в
                форме правки — при том что именно они отвечают на вопрос «можно
                ли доверять этим числам». */}
            <Section title={t("card.passport")} density="compact">
              <FactList>
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
                <dd className="m-0 tabular-nums">
                  {formatIsoDate(data.verified_at) ?? data.verified_at}
                </dd>

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
              </FactList>
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

const ENERGY_FIELDS = ["fat_100g", "protein_100g", "carbs_100g"] as const;

type ValueField =
  "kcal_100g" | "fat_100g" | "protein_100g" | "carbs_100g" | "fiber_100g";

/** Число и под ним — откуда оно взято, если это известно отдельно от строки. */
function ValueWithSource({
  value,
  source,
}: {
  value: string;
  source: string | null;
}) {
  if (!source) return <>{value}</>;
  return (
    <span className="flex flex-col">
      <span>{value}</span>
      <span className="text-xs text-muted-foreground">{source}</span>
    </span>
  );
}
