import {
  AsyncSection,
  EmptyState,
  formatOccurredAt,
  Section,
  Skeleton,
  WarningBanner,
} from "@ketocare/ui";
import { History } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { AuditPayload } from "./AuditPayload";
import { shortId } from "./format";
import { useProductRevisions } from "./useAuditLog";

/**
 * История ревизий позиции (раздел 8.3 ТЗ, «Админ / Продукты»).
 *
 * Показывает, кто и когда менял карточку и что именно изменилось: значения
 * продукта попадают в расчёт меню ребёнка, и «кто поменял жиры» — вопрос,
 * который задают после инцидента, а не до него.
 */
export function ProductRevisions({ productId }: { productId: string }) {
  const { t } = useTranslation("admin");
  const revisions = useProductRevisions(productId);

  const entries = revisions.data?.entries ?? [];
  // Отбор по позиции делает сервер, поэтому «показано не всё» может означать
  // только выход за размер страницы — а правок одной карточки столько не бывает.
  const incomplete =
    revisions.data !== undefined && revisions.data.total > entries.length;

  return (
    <Section title={t("products.revisions.title")}>
      {/* Ошибка не прячет уже загруженную историю — правило в AsyncSection. */}
      <AsyncSection
        loading={revisions.isLoading}
        skeleton={
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-block"
          >
            <span className="sr-only">{t("products.revisions.loading")}</span>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex flex-col gap-field">
                <Skeleton className="h-4 w-64 max-w-full" />
                <Skeleton className="h-6 w-40 max-w-full" />
              </div>
            ))}
          </div>
        }
        error={
          revisions.isError
            ? {
                title: t("products.revisions.error"),
                description:
                  errorMessageOf(revisions.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void revisions.refetch()}
        isEmpty={entries.length === 0}
        empty={
          <EmptyState
            icon={History}
            title={t("products.revisions.empty.title")}
            description={t("products.revisions.empty.description")}
          />
        }
      >
        <>
          {incomplete && (
            <WarningBanner level="info">
              {t("products.revisions.incomplete", {
                shown: entries.length,
                total: revisions.data?.total ?? 0,
              })}
            </WarningBanner>
          )}

          <ol className="m-0 flex list-none flex-col gap-block p-0">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="border-b border-border pb-3 last:border-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <time
                    className="text-sm text-muted-foreground tabular-nums"
                    dateTime={entry.created_at}
                  >
                    {formatOccurredAt(new Date(entry.created_at))}
                  </time>
                  <span className="font-semibold">
                    {t(`audit.actions.${entry.action}`, {
                      defaultValue: entry.action,
                    })}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {entry.user_id === null
                      ? t("audit.noUser")
                      : t("products.revisions.author", {
                          id: shortId(entry.user_id),
                        })}
                  </span>
                </div>
                <div className="mt-2">
                  <AuditPayload entry={entry} />
                </div>
              </li>
            ))}
          </ol>
        </>
      </AsyncSection>
    </Section>
  );
}
