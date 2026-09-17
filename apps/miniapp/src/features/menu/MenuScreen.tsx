import {
  AsyncSection,
  Button,
  MacroBar,
  Section,
  WarningBanner,
  formatMass,
} from "@ketocare/ui";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { usePatientOverview } from "../home/useOverview";
import type { Session } from "../session/useSession";
import { ComposePanel } from "./ComposePanel";
import { itemsOf, mealNumbers, withDish, withoutItem } from "./dayPlan";
import type { Menu, MenuItem } from "./useMenu";
import { today, tomorrow, useMarkEaten, useMenu } from "./useMenu";
import { useSaveMenu } from "./useSaveMenu";

/**
 * Приёмы, которые есть в плане, в порядке дня.
 *
 * Экран показывает только занятые приёмы — он на чтение, добавлять сюда
 * нечего. Номер приёма приходит с сервера (ADR-0029), и перечислять их
 * заранее списком из четырёх имён больше нельзя: врач назначает до десяти.
 * Позиции уже отсортированы сервером, `Set` сохраняет этот порядок.
 */
function plannedMeals(items: readonly { meal_index: number }[]): number[] {
  return [...new Set(items.map((item) => item.meal_index))];
}
/** Причина отказа отметки — описание её чекбокса для скринридера. */
function markFailedId(itemId: string): string {
  return `mark-failed-${itemId}`;
}

// Граммовку плана читают по строке, а не сравнивают столбцом: целые остаются
// целыми (правило П45 канона — `formatMass` кита).

/**
 * План питания с отметками «съедено» и сборкой дня (раздел 9 ТЗ).
 *
 * **Собрать день теперь можно отсюда.** Прежде экран был только на чтение с
 * доводом «меню составляют за столом, а отмечают на ходу» — он перестал быть
 * верным с этапа Б: у семьи из Telegram веб-кабинета нет вовсе, и «за столом»
 * ей было не с чем сесть. Отправлять её в браузер телефона, где она не вошла,
 * значит предлагать не путь, а его видимость.
 *
 * Свободного текста здесь по-прежнему нет: придуманная еда попала бы в итоги дня
 * наравне с настоящей. Состав собирается только из опубликованных рецептов и
 * своих блюд ребёнка, а итоги считает ядро на сервере.
 */
export function MenuScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  // Хранится СДВИГ, а не дата: приложение, открытое в 23:58, после полуночи
  // иначе показывало бы вчерашний план, не подсветив ни одной кнопки — а
  // «собрать вечером на завтра» это ровно про то время суток.
  const [dayOffset, setDayOffset] = useState(0);
  const [composing, setComposing] = useState(false);
  const day = dayOffset === 0 ? today() : tomorrow();
  const menu = useMenu(session.patientId, day);
  const mark = useMarkEaten(session.patientId, day);
  const save = useSaveMenu(session.patientId, day);
  // Число приёмов задаёт врач; без назначения раскладывать день не по чему.
  const overview = usePatientOverview(session.patientId);
  const meals = mealNumbers(overview.data?.prescription?.meals_per_day ?? null);

  // **Состав дня обязан быть известен достоверно.** `PUT` задаёт весь день, и
  // отправленный из незагруженного состояния он означает «день теперь состоит
  // только из этого»: прежние позиции сервер мягко удалит вместе с отметками
  // «съедено» и ссылками записей дневника еды. `menu.data` равно `undefined`,
  // пока запрос идёт, и остаётся им при отказе — поэтому право писать даёт
  // только успешный ответ, а не отсутствие данных.
  const planKnown = menu.isSuccess;

  const addDish = ({
    dish,
    mealIndex,
    portionFactor,
  }: {
    dish: { kind: "recipe" | "custom"; id: string };
    mealIndex: number;
    portionFactor: number;
  }) => {
    if (!planKnown) return;
    save.mutate(
      withDish(itemsOf(menu.data ?? null), dish, mealIndex, portionFactor),
      { onSuccess: () => setComposing(false) },
    );
  };

  return (
    <main className="flex flex-col gap-block p-block">
      <h1 className="text-page-title">{t("menu.title")}</h1>

      {/* Сегодня и завтра: план собирают вечером на завтра, а отмечают
          выполнение сегодня. Третьей даты нет намеренно — см. `tomorrow()`. */}
      <div className="flex gap-field" role="group" aria-label={t("menu.day")}>
        {[
          { offset: 0, label: t("menu.today") },
          { offset: 1, label: t("menu.tomorrow") },
        ].map((option) => (
          <Button
            key={option.offset}
            type="button"
            variant={dayOffset === option.offset ? "default" : "outline"}
            className="min-h-touch"
            aria-pressed={dayOffset === option.offset}
            onClick={() => {
              setDayOffset(option.offset);
              setComposing(false);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {composing ? (
        <Section title={t("menu.compose.title")} density="compact">
          {!overview.isSuccess ? (
            // «Назначения нет» — утверждение о клиническом факте, и говорить его
            // из незнания нельзя: сводка могла ещё не прийти или отказать.
            <p className="m-0 text-muted-foreground">
              {t("menu.compose.prescriptionUnknown")}
            </p>
          ) : meals.length === 0 ? (
            <p className="m-0 text-muted-foreground">
              {t("menu.compose.noPrescription")}
            </p>
          ) : (
            <ComposePanel
              patientId={session.patientId}
              meals={meals}
              saving={save.isPending}
              saveError={save.isError ? save.error : null}
              onAdd={addDish}
              onCancel={() => setComposing(false)}
            />
          )}
        </Section>
      ) : (
        // Кнопки нет, пока состав дня неизвестен: предлагать собрать день, не
        // зная, что в нём стоит, — это предлагать его стереть. Что происходит,
        // объясняет блок ниже: ожидание, отказ с повтором или пустой план.
        planKnown && (
          <Button
            type="button"
            className="min-h-touch self-start"
            onClick={() => setComposing(true)}
          >
            {t("menu.compose.open")}
          </Button>
        )
      )}

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
        waiting={
          menu.fetchStatus === "paused" ? t("errors.waitingForNetwork") : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void menu.refetch()}
        isEmpty={menu.data === null}
        empty={
          // Пустое состояние отправляло в кабинет, не давая туда пути: адреса
          // кабинета у Mini App не было ни одной переменной сборки. С этапа Б
          // он приходит в сессии (`web_url`), и «там же» стало ссылкой.
          <div className="flex flex-col gap-field">
            <p className="m-0 text-muted-foreground">{t("menu.none")}</p>
            <a
              className="text-primary underline underline-offset-4"
              href={session.webUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("menu.openWeb")}
            </a>
          </div>
        }
      >
        {menu.data != null && (
          <DayPlan
            menu={menu.data}
            onToggle={(item) =>
              mark.mutate({ itemId: item.id, eaten: !item.eaten })
            }
            onRemove={(item) => {
              if (!planKnown) return;
              save.mutate(withoutItem(menu.data ?? null, item.id));
            }}
            removing={save.isPending}
            // Отказ записи называется словами под планом: «Убрать» нажимают при
            // закрытой панели, и её сообщение об ошибке туда не доходит —
            // кнопка просто включалась обратно, а позиция оставалась на месте.
            saveFailed={
              save.isError
                ? (errorMessageOf(save.error) ?? t("menu.compose.failed"))
                : null
            }
            pendingId={mark.isPending ? mark.variables?.itemId : undefined}
            failedId={mark.isError ? mark.variables?.itemId : undefined}
            failure={errorMessageOf(mark.error) ?? t("menu.markFailedHint")}
          />
        )}
      </AsyncSection>
    </main>
  );
}

function DayPlan({
  menu,
  onToggle,
  onRemove,
  removing,
  saveFailed,
  pendingId,
  failedId,
  failure,
}: {
  menu: Menu;
  onToggle: (item: MenuItem) => void;
  onRemove: (item: MenuItem) => void;
  removing: boolean;
  saveFailed: string | null;
  pendingId: string | undefined;
  failedId: string | undefined;
  failure: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-block">
      {saveFailed !== null && (
        <WarningBanner level="danger" title={t("menu.compose.removeFailed")}>
          {saveFailed}
        </WarningBanner>
      )}

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

      {plannedMeals(menu.items).map((mealIndex) => {
        const items = menu.items.filter(
          (item) => item.meal_index === mealIndex,
        );

        return (
          <Section
            key={mealIndex}
            title={t("menu.meal", { index: mealIndex })}
            density="compact"
          >
            <ul className="flex flex-col gap-field">
              {items.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-field">
                    <input
                      type="checkbox"
                      className="mt-1 size-5 shrink-0 accent-primary"
                      checked={item.eaten}
                      disabled={pendingId === item.id}
                      aria-describedby={
                        failedId === item.id ? markFailedId(item.id) : undefined
                      }
                      onChange={() => {
                        onToggle(item);
                      }}
                    />
                    <span className="min-w-0 break-words">
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

                  {/* Убрать можно только неотмеченное. Съеденное блюдо — это
                      уже не план, а запись о том, что ребёнок ел: снять её
                      одним нажатием значило бы потерять клинические данные
                      мимо чьего-либо решения. Сначала снимается отметка. */}
                  {!item.eaten && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-9 min-h-touch"
                      disabled={removing}
                      onClick={() => onRemove(item)}
                    >
                      {t("menu.compose.remove")}
                    </Button>
                  )}

                  {/* Отказ отметки называется словами и стоит под той
                      позицией, которую не приняли: без сети отметка отказывает
                      сразу (ADR-0034), а галочка, молча вернувшаяся назад,
                      читалась бы как «нажатие не сработало». Внизу экрана
                      баннер на телефоне оказывался ниже сгиба. */}
                  {failedId === item.id && (
                    <WarningBanner
                      id={markFailedId(item.id)}
                      level="danger"
                      title={t("menu.markFailed")}
                      className="mt-1 ml-9 w-auto"
                    >
                      {failure}
                    </WarningBanner>
                  )}

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
                            <span className="min-w-0 break-words">
                              {line.name_ru}
                            </span>
                            <span className="text-muted-foreground tabular-nums">
                              {t("menu.grams", {
                                value: formatMass(line.grams),
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
