import {
  AsyncSection,
  Badge,
  EmptyState,
  formatOccurredAt,
  Section,
  Skeleton,
} from "@ketocare/ui";
import { History } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { changedFields, type RevisionField } from "./revisionDiff";
import { useProductRevisions } from "./useProductRevisions";

/**
 * История изменений позиции справочника.
 *
 * Читает `product_revisions` — настоящую историю, которую репозиторий пишет
 * при каждом создании и правке. До этого экран показывал вместо неё журнал
 * аудита, отобранный по `entity_id`, а импорт пишет одну запись на весь файл,
 * без идентификатора продукта: у всех импортированных позиций история
 * выглядела пустой, хотя в базе она была с самого их появления.
 *
 * Показывается разница с предыдущей записью, а не снимок целиком: «жиры
 * 81.1 → 82.5» отвечает на вопрос, ради которого сюда приходят, а полный
 * список из одиннадцати полей его прячет.
 */
export function ProductRevisions({ productId }: { productId: string }) {
  const { t } = useTranslation("products");
  const revisions = useProductRevisions(productId);

  const items = revisions.data?.items ?? [];

  return (
    <Section title={t("revisions.title")}>
      {/* Ошибка не прячет уже загруженную историю — правило в AsyncSection. */}
      <AsyncSection
        loading={revisions.isLoading}
        skeleton={
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-block"
          >
            <span className="sr-only">{t("revisions.loading")}</span>
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
                title: t("revisions.error"),
                description:
                  errorMessageOf(revisions.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void revisions.refetch()}
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={History}
            title={t("revisions.empty.title")}
            description={t("revisions.empty.description")}
          />
        }
      >
        <ol
          aria-label={t("revisions.title")}
          className="m-0 flex list-none flex-col gap-block p-0"
        >
          {items.map((entry, index) => {
            // Список идёт от новых к старым, значит предыдущая запись — та,
            // что ниже. У самой старой предыдущей нет: это заведение позиции.
            const previous = items[index + 1]?.snapshot ?? null;
            const changes = changedFields(entry.snapshot, previous);

            return (
              <li
                key={entry.id}
                className="border-b border-border pb-3 last:border-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <time
                    className="text-sm text-muted-foreground tabular-nums"
                    dateTime={entry.changed_at}
                  >
                    {formatOccurredAt(new Date(entry.changed_at))}
                  </time>
                  <span className="font-semibold">
                    {entry.changed_by_name ?? t("revisions.unknownAuthor")}
                  </span>
                  {previous === null && (
                    <Badge variant="outline">{t("revisions.created")}</Badge>
                  )}
                </div>

                {previous !== null &&
                  (changes.length === 0 ? (
                    <p className="m-0 mt-1 text-sm text-muted-foreground">
                      {t("revisions.noVisibleChanges")}
                    </p>
                  ) : (
                    <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                      {changes.map((change) => (
                        <li key={change.field} className="text-sm">
                          <span className="text-muted-foreground">
                            {t(`revisions.fields.${change.field}`)}:{" "}
                          </span>
                          <span className="tabular-nums">
                            {formatValue(t, change.field, change.before)}
                          </span>
                          <span aria-hidden="true"> → </span>
                          <span className="sr-only">
                            {t("revisions.becomes")}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatValue(t, change.field, change.after)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ))}
              </li>
            );
          })}
        </ol>
      </AsyncSection>
    </Section>
  );
}

/** Значение снимка в человеческом виде: да/нет вместо true/false, «—» вместо пустоты. */
function formatValue(
  t: ReturnType<typeof useTranslation<"products">>["t"],
  field: RevisionField,
  value: unknown,
): string {
  if (field === "is_active") {
    return value === true ? t("revisions.active") : t("revisions.withdrawn");
  }
  if (value === null || value === undefined || value === "") {
    return t("revisions.empty.value");
  }
  return String(value);
}
