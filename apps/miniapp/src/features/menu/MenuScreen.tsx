import { AsyncSection, MacroBar, Section, WarningBanner } from "@ketocare/ui";

import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import type { Session } from "../session/useSession";
import type { Menu, MenuItem } from "./useMenu";
import { today, useMarkEaten, useMenu } from "./useMenu";

const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
/** Целые граммы — целыми: «50 г», а не «50.0 г». Дробные — с одним знаком. */
function formatGrams(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * План питания на сегодня с отметками «съедено» (раздел 9 ТЗ).
 *
 * Того же вида, что в кабинете, но без правки состава: меню составляют за
 * столом, а отмечают выполнение — на ходу, и это разные занятия. Свободного
 * текста здесь нет до этапа 4: придуманная еда попала бы в итоги дня наравне с
 * настоящей.
 */
export function MenuScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  const day = today();
  const menu = useMenu(session.patientId, day);
  const mark = useMarkEaten(session.patientId, day);

  return (
    <main className="flex flex-col gap-block p-block">
      <h1 className="text-page-title">{t("menu.title")}</h1>

      <AsyncSection
        loading={menu.isPending}
        skeleton={null}
        error={
          menu.isError
            ? {
                title: t("menu.loadError"),
                description:
                  errorMessageOf(menu.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void menu.refetch()}
        isEmpty={menu.data === null}
        empty={<p className="text-muted-foreground">{t("menu.none")}</p>}
      >
        {menu.data != null && (
          <DayPlan
            menu={menu.data}
            onToggle={(item) =>
              mark.mutate({ itemId: item.id, eaten: !item.eaten })
            }
            pendingId={mark.isPending ? mark.variables?.itemId : undefined}
          />
        )}
      </AsyncSection>
    </main>
  );
}

function DayPlan({
  menu,
  onToggle,
  pendingId,
}: {
  menu: Menu;
  onToggle: (item: MenuItem) => void;
  pendingId: string | undefined;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-block">
      {menu.excluded_products.length > 0 && (
        // Молчать нельзя: по этому плану кормят сегодня. Но и запрещать день
        // нельзя — исключения уточняются по ходу терапии, а вчерашний план мог
        // быть согласован с врачом (вопрос 29 медкоманде).
        <WarningBanner level="danger" title={t("menu.excluded")}>
          {menu.excluded_products.map((product) => product.name_ru).join(", ")}
        </WarningBanner>
      )}

      {menu.withdrawn_products.length > 0 && (
        <WarningBanner level="warning" title={t("menu.withdrawn")}>
          {menu.withdrawn_products.map((product) => product.name_ru).join(", ")}
        </WarningBanner>
      )}

      {SLOTS.map((slot) => {
        const items = menu.items.filter((item) => item.meal_slot === slot);
        if (items.length === 0) return null;

        return (
          <Section key={slot} title={t(`menu.slots.${slot}`)} density="compact">
            <ul className="flex flex-col gap-field">
              {items.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-field">
                    <input
                      type="checkbox"
                      className="mt-1 size-5 accent-primary"
                      checked={item.eaten}
                      disabled={pendingId === item.id}
                      onChange={() => {
                        onToggle(item);
                      }}
                    />
                    <span>
                      {item.title ?? t("menu.unknownDish")}
                      {item.changed_since_saved && (
                        // День от правки рецепта не меняется — в том и смысл
                        // снимка, — но семье решать, пересобрать его или нет.
                        <span className="block text-muted-foreground">
                          {t("menu.changedSinceSaved")}
                        </span>
                      )}
                    </span>
                  </label>

                  {/* Что и сколько взвесить — по требованию, как в кабинете:
                      у плиты нужна граммовка, при беглом взгляде — названия.
                      Граммы приходят с сервера уже на эту позицию (М1):
                      доумножать их здесь нечем — числа порций клиент не видит. */}
                  {(item.ingredients ?? []).length > 0 && (
                    <details className="pl-9 text-sm">
                      <summary className="min-h-(--spacing-touch) cursor-pointer py-1 text-muted-foreground">
                        {t("menu.composition")}
                      </summary>
                      <ul className="flex list-none flex-col gap-1 p-0 pt-1">
                        {(item.ingredients ?? []).map((line) => (
                          <li
                            key={line.product_id}
                            className="flex flex-wrap justify-between gap-field"
                          >
                            <span>{line.name_ru}</span>
                            <span className="text-muted-foreground tabular-nums">
                              {t("menu.grams", {
                                value: formatGrams(line.grams),
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        );
      })}

      {menu.totals !== null && menu.totals !== undefined && (
        <Section title={t("menu.totals")} density="compact">
          <MacroBar
            fatG={menu.totals.fat}
            proteinG={menu.totals.protein}
            carbsG={menu.totals.carbs}
            showGrams
          />
        </Section>
      )}
    </div>
  );
}
