import { WarningBanner, formatOccurredAt } from "@ketocare/ui";
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
  const incomplete =
    revisions.data !== undefined &&
    revisions.data.total > revisions.data.scanned;

  return (
    <section className="rounded-kc border border-line p-4">
      <h3 className="mt-0 mb-3 text-base font-semibold">
        {t("products.revisions.title")}
      </h3>

      {revisions.isError && (
        <p role="alert" className="m-0 text-danger">
          {errorMessageOf(revisions.error) ?? t("common:errors.unexpected")}
        </p>
      )}

      {revisions.isLoading && (
        <p role="status" className="m-0 text-muted">
          {t("products.revisions.loading")}
        </p>
      )}

      {incomplete && (
        <WarningBanner level="info" className="mb-3">
          {t("products.revisions.incomplete", {
            scanned: revisions.data?.scanned ?? 0,
            total: revisions.data?.total ?? 0,
          })}
        </WarningBanner>
      )}

      {!revisions.isLoading && !revisions.isError && entries.length === 0 && (
        <p className="m-0 text-muted">{t("products.revisions.empty")}</p>
      )}

      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="border-b border-line pb-3 last:border-0"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <time
                className="text-sm text-muted tabular-nums"
                dateTime={entry.created_at}
              >
                {formatOccurredAt(new Date(entry.created_at))}
              </time>
              <span className="font-semibold">
                {t(`audit.actions.${entry.action}`, {
                  defaultValue: entry.action,
                })}
              </span>
              <span className="text-sm text-muted">
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
    </section>
  );
}
