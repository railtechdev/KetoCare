import {
  AsyncSection,
  Button,
  Section,
  WarningBanner,
  formatDayTime,
  formatMass,
} from "@ketocare/ui";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ExternalLink } from "../../components/ExternalLink";
import { TelegramConfirmDialog } from "../../components/TelegramConfirmDialog";
import { errorMessageOf } from "../../lib/api";
import { usePatientOverview } from "../home/useOverview";
import type { Session } from "../session/useSession";
import { ComposePanel } from "./ComposePanel";
import { DayTotals, type DayTargets, type DayVerdictInput } from "./DayTotals";
import {
  copiedDay,
  itemsOf,
  mealNumbers,
  withDish,
  withoutItem,
} from "./dayPlan";
import type { Menu, MenuItem } from "./useMenu";
import { dayAt, isPlanChanged, useMarkEaten, useMenu } from "./useMenu";
import { useSaveMenu } from "./useSaveMenu";

/**
 * Дни, между которыми переключается экран: вчера, сегодня, завтра.
 *
 * Вчера — чтобы отметить съеденное задним числом (вечером отмечать некогда, а
 * по отметкам врач судит, выполнялся ли план) и посмотреть, что ребёнок ел.
 * Завтра — план собирают вечером на завтра. Календаря нет: см. `dayAt`.
 */
const DAYS = [
  { offset: -1, label: "menu.yesterday" },
  { offset: 0, label: "menu.today" },
  { offset: 1, label: "menu.tomorrow" },
] as const;

/** Подпись «Как вчера» с точки зрения выбранного дня. */
const COPY_LABEL: Record<number, string> = {
  [-1]: "menu.copy.asDayBeforeYesterday",
  0: "menu.copy.asYesterday",
  1: "menu.copy.asToday",
};

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
  const day = dayAt(dayOffset);
  const menu = useMenu(session.patientId, day);
  const mark = useMarkEaten(session.patientId, day);
  const save = useSaveMenu(session.patientId, day);
  // Перенос дня — своей мутацией: её отказ называется у кнопки переноса, а
  // отказ добавления блюда — в панели сборки. Одна общая мутация показала бы
  // «не удалось перенести день» после неудачного добавления блюда.
  const copy = useSaveMenu(session.patientId, day);
  // Число приёмов задаёт врач; без назначения раскладывать день не по чему.
  const overview = usePatientOverview(session.patientId);
  const prescription = overview.data?.prescription ?? null;
  const meals = mealNumbers(prescription?.meals_per_day ?? null);
  // Цели берутся из активного назначения, а не из сводки за день: сводка
  // посчитана для сегодня, а назначение действует и завтра — на вкладке
  // «Завтра» цели обязаны остаться теми же.
  const targets: DayTargets | null =
    prescription === null
      ? null
      : {
          kcalPerDay: prescription.kcal_per_day,
          carbsLimitG: prescription.carbs_limit_g,
        };

  // **Состав дня обязан быть известен достоверно.** `PUT` задаёт весь день, и
  // отправленный из незагруженного состояния он означает «день теперь состоит
  // только из этого»: прежние позиции сервер мягко удалит вместе с отметками
  // «съедено» и ссылками записей дневника еды. `menu.data` равно `undefined`,
  // пока запрос идёт, и остаётся им при отказе — поэтому право писать даёт
  // только успешный ответ, а не отсутствие данных.
  const planKnown = menu.isSuccess;

  // «Как вчера» предлагается только достоверно ПУСТОМУ дню (см. `copiedDay`).
  // Предыдущий день запрашивается только тогда: в непустой день переносить
  // нельзя, и лишний запрос на каждое переключение дня был бы впустую.
  const dayEmpty = planKnown && (menu.data?.items.length ?? 0) === 0;
  const previous = useMenu(session.patientId, dayAt(dayOffset - 1), {
    enabled: dayEmpty,
  });
  const copied =
    dayEmpty && previous.isSuccess
      ? copiedDay(previous.data ?? null, menu.data ?? null)
      : null;

  // Вердикт о допуске сервер считает только за сегодня и отдаёт в сводке.
  // Пока сводка перезагружается после правки плана, вердикт относится к
  // прежнему составу: лучше промолчать причиной «сейчас не показано», чем
  // показать чужое (то же правило, что `useDayTolerance` кабинета). Дата
  // сверяется со сводкой: у сервера свои сутки, и около полуночи «сегодня»
  // телефона и сервера могут разойтись.
  const verdictFresh =
    overview.isSuccess && !overview.isFetching && overview.data.date === day;
  const verdict: DayVerdictInput = {
    otherDay: dayOffset !== 0,
    tolerance: verdictFresh ? (overview.data.day?.tolerance ?? null) : null,
    gap: verdictFresh ? (overview.data.day?.tolerance_gap ?? null) : null,
  };

  const addDish = ({
    dish,
    mealIndex,
    portionFactor,
  }: {
    dish: { kind: "recipe" | "custom"; id: string };
    mealIndex: number;
    portionFactor: number;
  }) => {
    if (!planKnown || copy.isPending) return;
    save.mutate(
      withDish(itemsOf(menu.data ?? null), dish, mealIndex, portionFactor),
      { onSuccess: () => setComposing(false) },
    );
  };

  return (
    <main className="flex flex-col gap-section p-section">
      <h1 className="text-page-title">{t("menu.title")}</h1>

      {/* Три дня, а не календарь (см. `DAYS`). Кнопки делят строку поровну:
          на 360 px три подписи «Вчера / Сегодня / Завтра» помещаются в ряд, а
          перенос одной из них на вторую строку читался бы как другой выбор. */}
      <div className="flex gap-field" role="group" aria-label={t("menu.day")}>
        {DAYS.map((option) => (
          <Button
            key={option.offset}
            type="button"
            variant={dayOffset === option.offset ? "default" : "outline"}
            className="min-h-touch min-w-0 flex-1 px-2"
            aria-pressed={dayOffset === option.offset}
            onClick={() => {
              setDayOffset(option.offset);
              setComposing(false);
              // Отказ записи относится к дню, где её делали: на другом дне он
              // говорил бы о плане, которого на экране нет.
              save.reset();
              copy.reset();
            }}
          >
            {t(option.label)}
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
              saving={save.isPending || copy.isPending}
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
          // Главный выход — собрать день здесь же (ADR-0041). Ссылка на
          // кабинет — только тем, у кого он включён: у взрослого из Telegram
          // кабинета чаще всего нет, и ссылка вела бы на форму входа, войти в
          // которую ему нечем.
          <div className="flex flex-col gap-field">
            <p className="m-0 text-muted-foreground">{t("menu.none")}</p>
            {/* «Как вчера»: кето-меню повторяются, и собирать одинаковый день
                заново по блюду — шесть поисков вместо одного нажатия. Только
                в пустой день: перенос поверх непустого стёр бы отметки. */}
            {copied !== null && (
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-touch self-start"
                  disabled={copy.isPending || save.isPending}
                  aria-busy={copy.isPending || undefined}
                  onClick={() => {
                    if (!dayEmpty) return;
                    copy.mutate(copied);
                  }}
                >
                  {copy.isPending
                    ? t("menu.copy.copying")
                    : t(COPY_LABEL[dayOffset] ?? "menu.copy.asYesterday")}
                </Button>
                <p className="m-0 text-sm text-muted-foreground">
                  {t("menu.copy.hint")}
                </p>
              </div>
            )}
            {dayEmpty && previous.isSuccess && copied === null && (
              <p className="m-0 text-sm text-muted-foreground">
                {t("menu.copy.sourceEmpty")}
              </p>
            )}
            {copy.isError && (
              <WarningBanner level="danger" title={t("menu.copy.failed")}>
                {errorMessageOf(copy.error) ?? t("menu.compose.failed")}
              </WarningBanner>
            )}
            {session.hasWebCredentials && (
              <ExternalLink
                className="text-primary underline underline-offset-4"
                href={session.webUrl}
              >
                {t("menu.openWeb")}
              </ExternalLink>
            )}
          </div>
        }
      >
        {menu.data != null && (
          <DayPlan
            menu={menu.data}
            canMarkEaten={dayOffset <= 0}
            onToggle={(item) =>
              mark.mutate({ itemId: item.id, eaten: !item.eaten })
            }
            onRemove={(item) => {
              if (!planKnown) return;
              save.mutate(withoutItem(menu.data ?? null, item.id));
            }}
            removing={save.isPending}
            targets={targets}
            verdict={verdict}
            // Отказ записи называется словами под планом: «Убрать» нажимают при
            // закрытой панели, и её сообщение об ошибке туда не доходит —
            // кнопка просто включалась обратно, а позиция оставалась на месте.
            // Отметку отвергли, потому что план в ту же минуту пересохранили без
            // этого блюда (Н10): после перечитки позиции на экране нет, и
            // сказать это можно только над планом, а не у позиции.
            saveFailed={
              save.isError
                ? (errorMessageOf(save.error) ?? t("menu.compose.failed"))
                : mark.isError && isPlanChanged(mark.error)
                  ? (errorMessageOf(mark.error) ?? t("menu.markFailedHint"))
                  : null
            }
            pendingId={mark.isPending ? mark.variables?.itemId : undefined}
            failedId={
              mark.isError && !isPlanChanged(mark.error)
                ? mark.variables?.itemId
                : undefined
            }
            failure={errorMessageOf(mark.error) ?? t("menu.markFailedHint")}
          />
        )}
      </AsyncSection>
    </main>
  );
}

function DayPlan({
  menu,
  canMarkEaten,
  onToggle,
  onRemove,
  removing,
  saveFailed,
  targets,
  verdict,
  pendingId,
  failedId,
  failure,
}: {
  menu: Menu;
  /**
   * Ставится ли отметка «съедено». На завтра — нет: съесть будущий день нельзя,
   * а флажок у завтрашнего плана читался бы как «отметьте заранее» — и
   * отметка ушла бы врачу как съеденное (так же в кабинете, `DayComposer`).
   */
  canMarkEaten: boolean;
  onToggle: (item: MenuItem) => void;
  onRemove: (item: MenuItem) => void;
  removing: boolean;
  saveFailed: string | null;
  targets: DayTargets | null;
  verdict: DayVerdictInput;
  pendingId: string | undefined;
  failedId: string | undefined;
  failure: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-section">
      {!canMarkEaten && menu.items.length > 0 && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("menu.tomorrowNoEaten")}
        </p>
      )}
      {saveFailed !== null && (
        <WarningBanner level="danger" title={t("menu.compose.removeFailed")}>
          {saveFailed}
        </WarningBanner>
      )}

      {/* План составил специалист — семья должна это видеть (ADR-0047). */}
      {menu.updated_by_name && menu.updated_by_role !== "parent" && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("menu.composedBy", {
            name: menu.updated_by_name,
            when: formatDayTime(new Date(menu.updated_at)),
          })}
        </p>
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
                  <div className="flex items-start justify-between gap-section">
                    {canMarkEaten ? (
                      // Вся строка — цель касания не ниже 44 px, а не квадрат
                      // 20 px флажка: отмечают на ходу, одной рукой.
                      <label className="flex min-h-touch min-w-0 flex-1 cursor-pointer items-center gap-field py-1">
                        <input
                          type="checkbox"
                          className="size-6 shrink-0 accent-primary"
                          checked={item.eaten}
                          disabled={pendingId === item.id}
                          aria-describedby={
                            failedId === item.id
                              ? markFailedId(item.id)
                              : undefined
                          }
                          onChange={() => {
                            onToggle(item);
                          }}
                        />
                        <DishTitle item={item} />
                      </label>
                    ) : (
                      <p className="m-0 flex min-h-touch min-w-0 flex-1 items-center py-1">
                        <DishTitle item={item} />
                      </p>
                    )}

                    {/* Убрать можно только неотмеченное. Съеденное блюдо — это
                        уже не план, а запись о том, что ребёнок ел: снять её
                        одним нажатием значило бы потерять клинические данные
                        мимо чьего-либо решения. Сначала снимается отметка.

                        Справа и с подтверждением: кнопка стояла в 4 px под
                        флажком, и промах при отметке «съедено» убирал блюдо
                        из плана без вопроса. */}
                    {!item.eaten && (
                      <TelegramConfirmDialog
                        trigger={
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-touch shrink-0 text-muted-foreground"
                            disabled={removing}
                            aria-label={t("menu.compose.removeAria", {
                              title: item.title ?? t("menu.unknownDish"),
                            })}
                          >
                            {t("menu.compose.remove")}
                          </Button>
                        }
                        title={t("menu.compose.removeTitle", {
                          title: item.title ?? t("menu.unknownDish"),
                        })}
                        description={t("menu.compose.removeBody")}
                        confirmLabel={t("menu.compose.remove")}
                        cancelLabel={t("menu.compose.keep")}
                        onConfirm={() => onRemove(item)}
                      />
                    )}
                  </div>

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
                      className="mt-1 ml-8 w-auto"
                    >
                      {failure}
                    </WarningBanner>
                  )}

                  {/* Что и сколько взвесить — по требованию, как в кабинете:
                      у плиты нужна граммовка, при беглом взгляде — названия.
                      Граммы приходят с сервера уже на эту позицию (М1):
                      доумножать их здесь нечем — числа порций клиент не видит. */}
                  {(item.ingredients ?? []).length > 0 && (
                    <details className="pl-8 text-sm">
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
                              {/* Приправу взвешивают, но в итогах дня её нет
                                  (ADR-0054). */}
                              {line.counts_in_calculation === false && (
                                <span className="ml-2 text-muted-foreground">
                                  {t("menu.uncounted")}
                                </span>
                              )}
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

      <DayTotals menu={menu} targets={targets} verdict={verdict} />
    </div>
  );
}

/** Название позиции и пометка о правке рецепта после сохранения дня. */
function DishTitle({ item }: { item: MenuItem }) {
  const { t } = useTranslation();
  return (
    <span className="min-w-0 break-words">
      {item.title ?? t("menu.unknownDish")}
      {item.changed_since_saved && (
        // День от правки рецепта не меняется — в том и смысл снимка, — но
        // семье решать, пересобрать его или нет.
        <span className="block text-sm text-muted-foreground">
          {t("menu.changedSinceSaved")}
        </span>
      )}
    </span>
  );
}
