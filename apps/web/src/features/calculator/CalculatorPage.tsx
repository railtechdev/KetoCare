import {
  Button,
  Section,
  Separator,
  WarningBanner,
  mealTargetsFrom,
} from "@ketocare/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { useSectionItem } from "../../routes/useSectionTab";
import { parseIncoming, useIncomingComposition } from "./incomingDish";
import { usePatientOverview } from "../patients/overview";
import { DishResultView, type DishView } from "./DishResultView";
import { HandOffToPatient } from "./HandOffToPatient";
import { DishRows } from "./DishRows";
import { ProductPicker } from "./ProductPicker";
import { SaveDishForm } from "./SaveDishForm";
import type { DishRow } from "./types";
import { useProduct } from "./useProducts";
import {
  useScaleMutation,
  useSolveMutation,
  useVerifyMutation,
  type TargetsInput,
} from "./useCalcMutations";

/**
 * Задержка автоматического пересчёта.
 *
 * Правка граммовки — это несколько нажатий подряд; без задержки каждое
 * уходило бы в расчёт. Та же величина, что у поисковых полей.
 */
const AUTO_CALC_DELAY_MS = 400;

/**
 * Калькулятор: один экран, три функции раздела 9 ТЗ.
 *
 * **Вкладок больше нет, и это главное изменение.** Проверка, подбор и пересчёт
 * были тремя режимами — тремя РАЗНЫМИ экранами с разным поведением, — и
 * последовательность работы об это ломалась. Экран открывался на «Проверить»,
 * при том что главный вопрос и врача («выполнимо ли соотношение на этих
 * продуктах»), и родителя («сколько положить, чтобы вышло») — это подбор, а он
 * лежал за второй вкладкой. Наше единственное преимущество перед кабинетом, к
 * которому привыкла клиника (`docs/AUDIT_KDC.md`, там граммовку доводят
 * стрелками вручную), было спрятано.
 *
 * Теперь проверка — не режим, а постоянное состояние экрана: числа
 * пересчитываются по мере правки. Подбор и пересчёт — действия над составом:
 * они его ПЕРЕЗАПИСЫВАЮТ, поэтому остаются кнопками, а не считаются по ходу
 * набора. Разбор — ADR-0028.
 *
 * **Цель стоит над фактом, и она не выдумывается.** Раньше вердикт «блюдо не
 * сходится с целью» стоял на 318 px ВЫШЕ самой цели, а калорийность приёма была
 * зашитой в экране четырёхсоткой, подписанной как «задаётся вами». Теперь цель
 * приходит из назначения ребёнка вместе с арифметикой, по которой посчитана, а
 * без назначения её просто нет — и сравнивать тогда не с чем.
 *
 * Ребёнок необязателен: «выйдет ли 4:1 на этих продуктах» — вопрос о продуктах
 * (ADR-0027).
 */
export function CalculatorPage({ patientId }: { patientId?: string }) {
  const { t } = useTranslation("calculator");

  return (
    <PageLayout title={t("title")} intro={t("intro")} width="form">
      <CalculatorView patientId={patientId} />
    </PageLayout>
  );
}

/**
 * Тело калькулятора без оболочки экрана.
 *
 * Оболочку ставит вызывающий: у раздела кабинета это `CalculatorPage` выше, у
 * карты пациента — её собственный `PageLayout` с названием раздела. Вложить
 * `PageLayout` сюда нельзя: в карте заголовок уже есть, и второй дал бы `h1`
 * внутри `h1` — ровно так «Калькулятор» и напечатался в карте дважды. Тем же
 * устроен отчёт (`ReportsView`).
 */
export function CalculatorView({ patientId }: { patientId?: string }) {
  const { t } = useTranslation("calculator");

  const [rows, setRows] = useState<DishRow[]>([]);

  // Продукт, пришедший из справочника (`?item=<id>`). Справочник знает только
  // идентификатор, состав на 100 г нужно дочитать.
  const [incomingId, setIncomingId] = useSectionItem();
  const incoming = parseIncoming(incomingId);
  const incomingProduct = useProduct(
    incoming?.kind === "product" ? incoming.id : undefined,
  );
  // Готовое блюдо: рецепт или своя раскладка — приходит из карточки рецепта и
  // из списка блюд ребёнка.
  const incomingDish = useIncomingComposition(incoming, patientId);

  /**
   * Цель расчёта. `null` в каждой половине — «не задано».
   *
   * Двумя числами, а не одним объектом с умолчаниями: цель существует, только
   * когда названы обе половины. Объект с подставленными значениями невозможно
   * отличить от заполненного человеком — именно так и появилась четырёхсотка,
   * которую никто не вводил, но против которой выносился вердикт.
   */
  const [ratio, setRatio] = useState<number | null>(null);
  const [kcal, setKcal] = useState<number | null>(null);
  const [proteinMin, setProteinMin] = useState<number | null>(null);
  const [carbsMax, setCarbsMax] = useState<number | null>(null);
  const [factor, setFactor] = useState(2);

  const overview = usePatientOverview(patientId ?? null);
  const prescription = overview.data?.prescription ?? null;
  const suggested = useMemo(
    () => mealTargetsFrom(prescription),
    [prescription],
  );

  // Правка человека важнее назначения: он мог считать блюдо под другую цель
  // осознанно, и подставлять назначение поверх введённого — терять его ввод.
  const touched = useRef(false);

  useEffect(() => {
    if (suggested === null || touched.current) return;
    setRatio((current) => (current === null ? suggested.ratio : current));
    setKcal((current) => (current === null ? suggested.kcal : current));
  }, [suggested]);

  /**
   * Собранная цель. `useMemo` здесь не оптимизация, а условие правильности:
   * задержка сравнивает значения по ссылке, и цель, пересобранная на каждом
   * рендере, делала расчёт вечно «устаревшим» — вердикт не показывался никогда,
   * а проверка уходила на сервер по кругу.
   */
  const targets: TargetsInput | null = useMemo(
    () =>
      ratio !== null && kcal !== null
        ? { ratio, kcal, proteinMin, carbsMax }
        : null,
    [ratio, kcal, proteinMin, carbsMax],
  );

  // Какое блюдо уже разложено на экране. Ссылка из адреса НЕ снимается: она
  // описывает, что открыто, и после F5 состав должен вернуться. А вот применять
  // её повторно нельзя — правки граммовки затирались бы исходным составом.
  const appliedDish = useRef<string | null>(null);

  useEffect(() => {
    const composition = incomingDish.rows;
    if (composition === null || composition.length === 0) return;
    if (incoming === null || appliedDish.current === incomingId) return;

    appliedDish.current = incomingId ?? null;
    // Состав блюда ЗАМЕЩАЕТ набранный: человек пришёл пересчитать конкретное
    // блюдо, а не дополнить им то, что было на экране.
    setRows(composition);
  }, [incomingDish.rows, incoming, incomingId]);

  useEffect(() => {
    const product = incomingProduct.data;
    if (product === undefined) return;

    // Параметр снимается сразу: он описывает не состояние экрана, а разовый
    // приход из справочника. Оставленный в адресе, он добавлял бы продукт
    // заново после каждой перезагрузки.
    setIncomingId(undefined);
    setRows((current) =>
      current.some((row) => row.product.id === product.id)
        ? current
        : [...current, { product, grams: 50 }],
    );
  }, [incomingProduct.data, setIncomingId]);

  const verify = useVerifyMutation();
  const solve = useSolveMutation();
  const scale = useScaleMutation();

  /**
   * Проверка идёт сама по мере правки состава и цели.
   *
   * Она ничего не перезаписывает, поэтому кнопки у неё нет: кнопка обещала бы
   * действие, которое уже произошло (правило П3 канона).
   */
  const debouncedRows = useDebouncedValue(rows, AUTO_CALC_DELAY_MS);
  const debouncedTargets = useDebouncedValue(targets, AUTO_CALC_DELAY_MS);
  const verifyMutate = verify.mutate;
  const verifyReset = verify.reset;

  useEffect(() => {
    if (debouncedRows.length === 0) {
      // Пустой состав не считают — но и числа прежнего блюда на экране не
      // оставляют: убрав последний продукт, человек видел его калорийность,
      // соотношение и предложение сохранить блюдо, которого больше нет.
      // Результат мутации сам не пропадает: он живёт, пока его не сбросят.
      verifyReset();
      return;
    }
    verifyMutate({
      rows: debouncedRows,
      targets: debouncedTargets ?? undefined,
      patientId,
    });
  }, [debouncedRows, debouncedTargets, patientId, verifyMutate, verifyReset]);

  /**
   * Массы, посчитанные сервером, уезжают прямо в состав.
   *
   * И подбор, и пересчёт порций перезаписывают граммовку — состав остаётся
   * единственным, что на экране считается вводом. Пока пересчёт показывал
   * новые массы отдельным списком, а старые оставлял в полях, в сохранение
   * уходили старые: родитель, сохранивший «двойную порцию», получал блюдо с
   * одинарной раскладкой.
   */
  const solvedItems = solve.data?.dish.items;
  const scaledItems = scale.data?.dish.items;

  useEffect(() => {
    const items = solvedItems ?? scaledItems;
    if (items === undefined) return;

    const grams = new Map(items.map((item) => [item.product_id, item.grams]));
    setRows((current) =>
      current.map((row) => {
        const next = grams.get(row.product.id);
        return next === undefined || next === row.grams
          ? row
          : { ...row, grams: next };
      }),
    );
  }, [solvedItems, scaledItems]);

  // Исключения приходят от сервера: сопоставить состав с тем, что ребёнку
  // нельзя, может только он — в браузере нет ни аллергий, ни каталога.
  const excluded = verify.data?.excluded ?? [];
  // Подбор не предупреждает об исключённом, а вычёркивает его со входа, и
  // сказать об этом больше негде: своего блока у результата подбора нет —
  // массы уезжают прямо в состав.
  const solveExcluded = solve.data?.excluded ?? [];
  const dish: DishView | null = verify.data?.dish ?? null;

  // Вклад каждой позиции — из того же ответа, что и итог блюда: сумма
  // вкладов и есть итог, ядро считает их одной арифметикой.
  const contributions = useMemo(
    () =>
      new Map(
        (verify.data?.dish.items ?? []).map((item) => [item.product_id, item]),
      ),
    [verify.data],
  );

  /**
   * Показанный результат посчитан не по тому, что сейчас в полях.
   *
   * Число на экране остаётся: гасить его на каждое нажатие — значит очищать тот
   * самый экран, по которому человек сверяется. А вот вердикт снимается.
   * Зелёный значок «в допуске», посчитанный при прежней цели, рядом с новым
   * числом — не устаревшая выдача, а неверное утверждение: по нему готовят еду
   * ребёнку.
   */
  const stale =
    rows !== debouncedRows || targets !== debouncedTargets || verify.isPending;

  const ratioWithin = stale ? undefined : verify.data?.ratio_within_tolerance;
  const kcalWithin = stale ? undefined : verify.data?.kcal_within_tolerance;

  const infeasible = errorCodeOf(solve.error) === "infeasible_calculation";
  const actionError = solve.isError || scale.isError;
  const busy = solve.isPending || scale.isPending;

  function resetActions() {
    solve.reset();
    scale.reset();
  }

  return (
    /* Ширину калькулятор несёт с собой, а не берёт у экрана: в разделе кабинета
       оболочка уже ограничена ролью «форма», а в карте пациента она шире —
       и те же блоки растягивались там на 1102 px под поля в 123 px. Одна
       колонка на все размещения — одна правая линия у поиска, состава, полосы
       макронутриентов и кнопок. */
    <div className="flex max-w-form flex-col gap-screen">
      <Section
        title={t("composition.title")}
        description={t("composition.description")}
      >
        <ProductPicker
          patientId={patientId}
          excludeIds={rows.map((r) => r.product.id)}
          onPick={(product) => {
            setRows((current) => [...current, { product, grams: 50 }]);
            resetActions();
          }}
        />

        <DishRows
          rows={rows}
          contributions={contributions}
          stale={stale}
          onChangeGrams={(productId, grams) => {
            setRows((current) =>
              current.map((row) =>
                row.product.id === productId ? { ...row, grams } : row,
              ),
            );
            resetActions();
          }}
          onRemove={(productId) => {
            setRows((current) =>
              current.filter((row) => row.product.id !== productId),
            );
            resetActions();
          }}
        />
      </Section>

      {/* Что ребёнку нельзя — над расчётом, а не под ним: подбор снимает такие
          продукты со входа, и по числам этого не видно.
          Запрещать или предупреждать — вопрос 29 медицинской команде. */}
      {(excluded.length > 0 || solveExcluded.length > 0) && (
        <WarningBanner level="danger" title={t("excluded.title")}>
          {excluded.length > 0 && (
            <p className="m-0">
              {t("excluded.verify", {
                list: namesOf(excluded, t("excluded.unknownProduct")),
              })}
            </p>
          )}
          {solveExcluded.length > 0 && (
            <p className="m-0">
              {t("excluded.solve", {
                list: namesOf(solveExcluded, t("excluded.unknownProduct")),
              })}
            </p>
          )}
        </WarningBanner>
      )}

      {/* Цель, факт и действия — одним блоком, в этом порядке. Цель обязана
          стоять выше вердикта о ней; факт обязан стоять рядом с составом, иначе
          правка граммовки уводит итог ниже сгиба (замер на 1280×800). Оба
          требования выполняются, только если цель и факт лежат в одном блоке —
          так же устроен и кабинет, к которому привыкла клиника: строка «Goal»
          прямо над строкой «Actual». */}
      <Section title={t("calc.title")}>
        <GoalFields
          ratio={ratio}
          kcal={kcal}
          suggested={suggested}
          prescription={prescription}
          onChange={(next) => {
            touched.current = true;
            setRatio(next.ratio);
            setKcal(next.kcal);
            resetActions();
          }}
        />

        {/* Пустой расчёт молчит: о том, что состав не набран, уже сказано в
            блоке состава — строкой над этим. Своя фраза здесь была вторым
            сообщением об одном и том же (правило П27 канона), и вместе с
            рамкой пустого состава они отодвигали цель на 200 px вниз. */}
        {dish === null ? null : (
          <div
            aria-busy={stale}
            className={stale ? "opacity-60 transition-opacity" : undefined}
          >
            <DishResultView
              dish={dish}
              goal={targets}
              ratioWithinTolerance={ratioWithin ?? undefined}
              kcalWithinTolerance={kcalWithin ?? undefined}
            />
            {stale && (
              <p role="status" className="m-0 text-sm text-muted-foreground">
                {t("recalculating")}
              </p>
            )}
          </div>
        )}

        <Separator />

        {/* Два действия, и у каждого свой ввод прямо над ним.

            Раньше ряд начинался кнопкой «Подобрать граммовку», за ней шло чужое
            поле «Коэффициент порции» с кнопкой пересчёта, а ограничения подбора
            стояли ПОД всем этим — то есть поля действия читались после самого
            действия, а два разных действия делили одну строку. Порядок «поля →
            кнопка» — правило П9 канона, и он же отвечает на вопрос «что эта
            кнопка возьмёт в расчёт».

            Подбор остаётся первым и крупным (ADR-0028): это главное, чего нет у
            KDC, где граммовку доводят стрелками вручную. */}
        <div className="flex flex-col gap-block">
          {/* Ограничения касаются только подбора: проверке они ничего не
              меняют. Поэтому стоят при его кнопке, а не в цели. */}
          <div className="flex flex-wrap items-start gap-block">
            <Field
              id="protein-min"
              width="narrow"
              label={t("targets.proteinMin")}
              optional
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={proteinMin ?? ""}
              onChange={(e) =>
                setProteinMin(e.target.value === "" ? null : +e.target.value)
              }
              className="tabular-nums"
            />
            <Field
              id="carbs-max"
              width="narrow"
              label={t("targets.carbsMax")}
              optional
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={carbsMax ?? ""}
              onChange={(e) =>
                setCarbsMax(e.target.value === "" ? null : +e.target.value)
              }
              className="tabular-nums"
            />
          </div>

          <div>
            <Button
              type="button"
              size="lg"
              className="min-h-touch"
              disabled={rows.length === 0 || targets === null || busy}
              aria-busy={solve.isPending}
              onClick={() => {
                if (targets === null) return;
                scale.reset();
                solve.mutate({ rows, targets, patientId });
              }}
            >
              {solve.isPending ? t("actions.solving") : t("actions.solve")}
            </Button>
          </div>

          {/* Пересчёт порций — второе действие, со своим числом.

              `[&_[data-slot=field]]:mb-0` снимает у поля нижний отступ формы:
              ряд равняется по низу, и без этого кнопка равнялась на нижний край
              ОТСТУПА поля, а не самого поля — поле оказывалось на 16 px выше. */}
          <div className="flex flex-wrap items-end gap-field [&_[data-slot=field]]:mb-0">
            <Field
              id="factor"
              width="tiny"
              label={t("factor")}
              // Пересчёт ПЕРЕПИСЫВАЕТ граммовку в составе, и сказать об этом
              // обязан тот, кто предлагает нажать: в Mini App подпись была, в
              // кабинете — нет.
              hint={t("factorHint")}
              type="number"
              inputMode="decimal"
              min={0.1}
              step={0.1}
              value={factor}
              onChange={(event) => setFactor(Number(event.target.value))}
              className="tabular-nums"
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-touch"
              disabled={rows.length === 0 || busy}
              aria-busy={scale.isPending}
              onClick={() => {
                solve.reset();
                scale.mutate({ rows, factor });
              }}
            >
              {scale.isPending ? t("actions.scaling") : t("actions.scale")}
            </Button>
          </div>
        </div>
      </Section>

      {/* Неразрешимая задача — не ошибка, а объяснимый результат (раздел 8.3 ТЗ):
          сервер возвращает человекочитаемую причину, её и показываем. Для врача
          это и есть ответ на его вопрос: назначение на этих продуктах не
          собирается. */}
      {infeasible && (
        <WarningBanner level="danger" title={t("infeasible.title")}>
          {errorMessageOf(solve.error)}
        </WarningBanner>
      )}

      {actionError && !infeasible && (
        <FormError>
          {errorMessageOf(solve.error ?? scale.error) ??
            t("common:errors.unexpected")}
        </FormError>
      )}

      {dish && (
        <>
          {/* Куда уходит собранный состав, зависит от того, чей это экран:
              в карте ребёнка — сразу в его блюда, в общем калькуляторе —
              вместе с выбором ребёнка. */}
          {patientId === undefined ? (
            <HandOffToPatient rows={rows} />
          ) : (
            <SaveDishForm patientId={patientId} rows={rows} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Названия исключённых продуктов, а не их идентификаторы: продукт могли убрать
 * из справочника, и 36 знаков UUID человеку не говорят ничего.
 *
 * Mini App говорит здесь словами с самого начала (находка М6 его аудита), а
 * кабинет печатал UUID — то самое расхождение каналов, ради которого экраны и
 * сводились.
 */
function namesOf(
  entries: { product_id: string; name_ru?: string | null }[],
  unknown: string,
) {
  return entries.map((entry) => entry.name_ru ?? unknown).join(", ");
}

/**
 * Цель расчёта: соотношение и калорийность приёма.
 *
 * Значения из назначения подставляются вместе с арифметикой, по которой
 * посчитаны, — «1200 ккал ÷ 4 приёма». Молча подставленное число неотличимо от
 * введённого человеком, а деление суточной нормы на приёмы — медицинское
 * допущение, и человек должен видеть, что оно принято. Само допущение живёт в
 * ките (`mealTargetsFrom`): та же цель показывается той же семье в Mini App.
 */
function GoalFields({
  ratio,
  kcal,
  suggested,
  prescription,
  onChange,
}: {
  ratio: number | null;
  kcal: number | null;
  suggested: TargetsInput | null;
  prescription: { kcal_per_day: number; meals_per_day: number } | null;
  onChange: (next: { ratio: number | null; kcal: number | null }) => void;
}) {
  const { t } = useTranslation("calculator");

  const fromPrescription =
    prescription === null
      ? null
      : t("goal.fromPrescription", {
          kcal: prescription.kcal_per_day,
          meals: prescription.meals_per_day,
        });

  return (
    <div className="flex flex-col gap-field">
      {/* Рядом и на телефоне: поля короткие (числовые, ширина из шкалы), а
          сложенные в столбик они отодвигали показатели блюда почти на сотню
          пикселей вниз — а они обязаны читаться рядом с целью.

          Ряд, а не две колонки блока: колонки делят ШИРИНУ БЛОКА пополам, и в
          блоке 1102 px поле «Кетосоотношение» (123 px по шкале) стояло в 559 px
          от поля «Калорийность» — пара читалась как два несвязанных поля, а
          пояснение к правому уезжало к краю экрана. Ширину пары теперь задают
          сами поля. */}
      <div className="flex items-start gap-block">
        {/* Каждое поле — своя доля строки на телефоне и своя ширина на
            десктопе: числовое поле занимает строку целиком до `sm`, и в
            свободном ряду пара распадалась на две строки — а показатели
            блюда обязаны читаться рядом с целью. */}
        <div className="min-w-0 flex-1 sm:flex-none">
          <Field
            id="ratio"
            width="narrow"
            label={t("targets.ratio")}
            hint={
              suggested !== null && ratio === suggested.ratio
                ? t("goal.ratioFromPrescription")
                : undefined
            }
            type="number"
            inputMode="decimal"
            min={1}
            max={5}
            step={0.5}
            value={ratio ?? ""}
            onChange={(e) =>
              onChange({
                ratio: e.target.value === "" ? null : +e.target.value,
                kcal,
              })
            }
            className="tabular-nums"
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none">
          <Field
            id="kcal"
            width="narrow"
            label={t("targets.kcal")}
            hint={
              suggested !== null && kcal === suggested.kcal
                ? (fromPrescription ?? undefined)
                : t("goal.kcalHint")
            }
            type="number"
            inputMode="decimal"
            min={1}
            step={10}
            value={kcal ?? ""}
            onChange={(e) =>
              onChange({
                ratio,
                kcal: e.target.value === "" ? null : +e.target.value,
              })
            }
            className="tabular-nums"
          />
        </div>
      </div>

      {/* Цели нет — и сравнивать не с чем. Сказать это прямо честнее, чем
          подставить своё число и объявить блюдо не попавшим в него. */}
      {(ratio === null || kcal === null) && (
        <p className="m-0 text-sm text-muted-foreground">{t("goal.none")}</p>
      )}
    </div>
  );
}
