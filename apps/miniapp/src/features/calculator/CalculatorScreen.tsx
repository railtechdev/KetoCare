import {
  ActionReason,
  Button,
  EmptyState,
  Input,
  MacroBar,
  MacroFacts,
  RatioBadge,
  Section,
  Separator,
  WarningBanner,
  cn,
  mealTargetsFrom,
} from "@ketocare/ui";
import { Trash2 } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { Session } from "../session/useSession";
import { usePatientOverview } from "../home/useOverview";
import {
  MIN_QUERY,
  type DishRow,
  type ProductOption,
  type Targets,
  parseAmount,
  useProductSearch,
  useScale,
  useSolve,
  useVerify,
} from "./useCalculator";

/** Та же задержка, что у поисковых полей: правка граммовки — несколько нажатий. */
const RECALC_DELAY_MS = 400;

/**
 * Калькулятор: один экран, три функции раздела 9 ТЗ.
 *
 * **Вкладок «Проверить / Подобрать / Пересчитать» больше нет.** Они разрезали
 * одно непрерывное действие на три экрана, и главное — решатель граммовки,
 * единственное, чего нет у системы, к которой привыкла клиника, — лежал за
 * второй вкладкой. Разбор и замеры — ADR-0028; кабинет переустроен так же, и
 * это не совпадение: экран отвечает на вопрос про здоровье ребёнка, и вести
 * себя по-разному в кабинете и в телефоне он не может.
 *
 * Проверка — не режим, а постоянное состояние экрана: числа пересчитываются по
 * мере правки. Подбор и пересчёт ПЕРЕЗАПИСЫВАЮТ граммовку, поэтому остаются
 * кнопками: расчёт по ходу набора вырывал бы поля из-под пальцев. Массы обоих
 * уезжают прямо в состав — он единственное, что на экране считается вводом.
 *
 * **Цель стоит над фактом и не выдумывается.** Соотношение и калорийность
 * приёма приходят из назначения ребёнка вместе с арифметикой, по которой
 * посчитаны; правка человека важнее подставленного. Без назначения поля пусты,
 * и вердикта нет: сравнивать не с чем.
 */
export function CalculatorScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DishRow[]>([]);

  /**
   * Цель — сырым вводом, как и граммовка.
   *
   * Строкой, а не числом: русская клавиатура телефона в числовом режиме даёт
   * запятую, и числовое состояние глотало бы её в момент набора («3,» →
   * «3»). Разбор — `parseAmount`, один на граммовку, цель и множитель.
   */
  const [ratio, setRatio] = useState("");
  const [kcal, setKcal] = useState("");
  const [proteinMin, setProteinMin] = useState("");
  const [carbsMax, setCarbsMax] = useState("");
  const [factor, setFactor] = useState("2");

  const overview = usePatientOverview(session.patientId);
  const prescription = overview.data?.prescription ?? null;

  /**
   * Цель приёма из назначения — общей функцией кита.
   *
   * Деление суточной нормы на приёмы поровну — медицинское допущение (вопрос 24
   * медкоманде), и своя копия здесь означала бы, что цель приёма зависит от
   * того, откуда семья смотрит: с телефона или из кабинета.
   */
  const suggested = useMemo(
    () => mealTargetsFrom(prescription),
    [prescription],
  );

  // Правка человека важнее назначения: он мог считать блюдо под другую цель
  // осознанно, и подставлять назначение поверх введённого — терять его ввод.
  const touched = useRef(false);

  useEffect(() => {
    if (suggested === null || touched.current) return;
    setRatio((current) => (current === "" ? String(suggested.ratio) : current));
    setKcal((current) => (current === "" ? String(suggested.kcal) : current));
  }, [suggested]);

  /**
   * Цель расчёта. Ссылка обязана быть постоянной между отрисовками: `stale`
   * ниже сравнивает её с задержанной копией ПО ССЫЛКЕ, и новый объект на
   * каждый рендер держал бы вердикт снятым навсегда — экран вечно
   * «пересчитываем».
   *
   * Пределы подбора сюда не входят намеренно: проверке они ничего не меняют, а
   * в ключе запроса гоняли бы её на сервер при каждом нажатии в их полях.
   */
  const goal: Targets | null = useMemo(
    () =>
      parseAmount(ratio) > 0 && parseAmount(kcal) > 0
        ? { ratio: parseAmount(ratio), kcal: parseAmount(kcal) }
        : null,
    [ratio, kcal],
  );

  const debouncedRows = useDebouncedValue(rows, RECALC_DELAY_MS);
  const debouncedGoal = useDebouncedValue(goal, RECALC_DELAY_MS);
  const verify = useVerify(session.patientId, debouncedRows, debouncedGoal);
  const solve = useSolve(session.patientId);
  const scale = useScale();

  /**
   * Массы, посчитанные сервером, уезжают прямо в состав.
   *
   * И подбор, и пересчёт перезаписывают граммовку. Пока пересчёт показывал
   * новые массы отдельным списком, а старые оставлял в полях, цепочка
   * «подобрал → округлил под кухонные весы → проверил» рвалась на первом шаге:
   * из результата вёл один выход — принять как есть.
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
        // Как есть, без своего округления: кабинет кладёт в поле то же число,
        // а «21.8» вместо 21.75 — уже другая граммовка, пусть и на 0.05 г.
        return next === undefined ? row : { ...row, grams: String(next) };
      }),
    );
  }, [solvedItems, scaledItems]);

  /**
   * Показанное посчитано не по тому, что сейчас в полях.
   *
   * Числа остаются на экране — гасить их на каждое нажатие значит очищать то,
   * по чему человек сверяется. А вердикт снимается: «цель достигнута»,
   * посчитанное при прежней граммовке, рядом с новым числом — не устаревшая
   * выдача, а неверное утверждение, и по нему готовят еду ребёнку.
   */
  const stale =
    rows !== debouncedRows || goal !== debouncedGoal || verify.isFetching;

  /**
   * Правка состава и цели обесценивает подобранное и пересчитанное.
   *
   * Проверка пересчитывается сама и результат не гасит — там число живёт доли
   * секунды до нового. Подбор запускает человек, и итог прежней раскладки
   * рядом с новым составом — утверждение о блюде, которого на экране уже нет.
   */
  function dropStaleResults() {
    solve.reset();
    scale.reset();
  }

  const dish = verify.data?.dish ?? null;
  const excluded = verify.data?.excluded ?? [];
  // Подбор не предупреждает об исключённом, а вычёркивает его со входа, и
  // сказать об этом больше негде: своего блока у результата подбора нет —
  // массы уезжают прямо в состав.
  const solveExcluded = solve.data?.excluded ?? [];

  // Вклад каждой позиции — из того же ответа, что и итог блюда: сумма вкладов
  // и есть итог, ядро считает их одной арифметикой.
  const contributions = useMemo(
    () =>
      new Map(
        (verify.data?.dish.items ?? []).map((item) => [item.product_id, item]),
      ),
    [verify.data],
  );

  const filled =
    rows.length > 0 && rows.every((row) => parseAmount(row.grams) > 0);
  const solveTargets: Targets | null =
    goal === null
      ? null
      : {
          ...goal,
          // Пустое поле — это «предела нет», а не ноль: ноль по белку означал
          // бы «белка не должно быть вовсе».
          protein_min_g:
            parseAmount(proteinMin) > 0 ? parseAmount(proteinMin) : null,
          carbs_max_g: parseAmount(carbsMax) > 0 ? parseAmount(carbsMax) : null,
        };
  const busy = solve.isPending || scale.isPending;

  /**
   * Чего не хватает, чтобы нажать (правило П44 канона).
   *
   * Серая кнопка без объяснения — тупик: в кабинете на этом застряла
   * заказчица и не дошла до подбора граммовки. Причина по одной за раз, в том
   * порядке, в каком их устраняют.
   */
  const solveBlockedBy =
    rows.length === 0
      ? t("calculator.blocked.noRows")
      : solveTargets === null
        ? t("calculator.blocked.noTargets")
        : null;
  const scaleBlockedBy =
    rows.length === 0
      ? t("calculator.blocked.noRows")
      : !filled
        ? t("calculator.blocked.noGrams")
        : parseAmount(factor) > 0
          ? null
          : t("calculator.blocked.noFactor");
  // Одна строка на блок действий, а не по одной на кнопку: при пустом составе
  // причины совпадают, и два одинаковых абзаца — второе сообщение об одном и
  // том же (правило П27), озвученное дважды.
  const actionsBlockedBy = solveBlockedBy ?? scaleBlockedBy;
  const reasonId = useId();

  const actionError = solve.error ?? scale.error;
  const infeasible = errorCodeOf(actionError) === "infeasible_calculation";
  // Отказ действия прячется, только если он дословно повторяет отказ проверки,
  // который на экране. Прятать по одному признаку «проверка в ошибке» значило бы
  // съесть другую причину — например, обрыв сети при подборе: нажал — и ничего.
  // Сравнивается только текст: заголовки обоих баннеров сейчас одинаковые
  // («Не удалось посчитать»). Переименуете один из них — сравнивайте и заголовок,
  // иначе начнёт прятаться баннер с другим заголовком.
  const verifyShown = verify.isError && !stale;
  const duplicateOfVerify =
    verifyShown &&
    actionError !== null &&
    actionError !== undefined &&
    errorMessageOf(actionError) === errorMessageOf(verify.error);

  return (
    <main className="flex flex-col gap-block p-block">
      <h1 className="text-page-title">{t("calculator.title")}</h1>

      <Section title={t("calculator.composition")} density="compact">
        <ProductPicker
          onPick={(product) => {
            setRows((current) =>
              current.some((row) => row.product.id === product.id)
                ? current
                : [...current, { product, grams: "" }],
            );
            dropStaleResults();
          }}
        />

        {rows.length === 0 ? (
          // Строкой, а не рамкой: о пустоте уже сказано здесь, и блок расчёта
          // ниже молчит (правило П27 канона).
          <EmptyState size="inline" title={t("calculator.empty")} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-field p-0">
            {rows.map((row, index) => {
              const contribution = contributions.get(row.product.id);

              return (
                <li
                  key={row.product.id}
                  className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-field">
                    <span className="min-w-0 flex-1 break-words">
                      {row.product.name}
                    </span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="w-20 text-right tabular-nums"
                      aria-label={t("calculator.grams", {
                        name: row.product.name,
                      })}
                      value={row.grams}
                      onChange={(event) => {
                        const grams = event.target.value;
                        setRows(
                          rows.map((r, i) =>
                            i === index ? { ...r, grams } : r,
                          ),
                        );
                        dropStaleResults();
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("calculator.remove", {
                        name: row.product.name,
                      })}
                      onClick={() => {
                        setRows(rows.filter((_, i) => i !== index));
                        dropStaleResults();
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </div>

                  {/* Что даёт этот продукт — тем же компонентом кита, что и в
                      кабинете: по вкладу видно, что менять, когда блюдо мимо
                      цели, а два своих оформления означали бы два округления
                      одного клинического числа. */}
                  {contribution !== undefined && (
                    <MacroFacts
                      label={t("calculator.contribution", {
                        name: row.product.name,
                      })}
                      kcal={contribution.kcal}
                      fatG={contribution.fat_g}
                      proteinG={contribution.protein_g}
                      carbsG={contribution.carbs_g}
                      stale={stale}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Что ребёнку нельзя — над расчётом, а не под ним: подбор снимает такие
          продукты со входа, и по числам этого не видно. */}
      {(excluded.length > 0 || solveExcluded.length > 0) && (
        <WarningBanner level="danger" title={t("calculator.excluded")}>
          {excluded.length > 0 && (
            <p className="m-0">
              {t("calculator.excludedVerify", { list: namesOf(excluded, t) })}
            </p>
          )}
          {solveExcluded.length > 0 && (
            <p className="m-0">
              {t("calculator.excludedSolve", {
                list: namesOf(solveExcluded, t),
              })}
            </p>
          )}
        </WarningBanner>
      )}

      {/* Цель, факт и действия — одним блоком, в этом порядке. Цель обязана
          стоять выше вердикта о ней; факт обязан стоять рядом с составом,
          иначе на телефоне правка граммовки уходит за сгиб и выглядит как
          «ничего не происходит». Оба требования выполняются, только если цель
          и факт лежат в одном блоке. */}
      <Section title={t("calculator.calc")} density="compact">
        <div className="flex items-start gap-field">
          <NumberField
            id="ratio"
            label={t("calculator.ratio")}
            value={ratio}
            hint={
              suggested !== null && ratio === String(suggested.ratio)
                ? t("calculator.ratioFromPrescription")
                : undefined
            }
            onChange={(value) => {
              touched.current = true;
              setRatio(value);
              dropStaleResults();
            }}
          />
          <NumberField
            id="meal-kcal"
            label={t("calculator.mealKcal")}
            value={kcal}
            hint={
              prescription !== null &&
              suggested !== null &&
              kcal === String(suggested.kcal)
                ? t("calculator.kcalFromPrescription", {
                    kcal: prescription.kcal_per_day,
                    meals: prescription.meals_per_day,
                  })
                : t("calculator.mealKcalHint")
            }
            onChange={(value) => {
              touched.current = true;
              setKcal(value);
              dropStaleResults();
            }}
          />
        </div>

        {goal === null && (
          <p className="m-0 text-sm text-muted-foreground">
            {t("calculator.noTargets")}
          </p>
        )}

        {/* Пустой расчёт молчит: о ненабранном составе сказано выше. */}
        {dish !== null && (
          <div className="flex flex-col gap-field">
            <div className="flex flex-wrap items-center gap-field">
              {/* `ratio` приходит пустым, когда делить не на что: в блюде из
                  одного масла нет ни белка, ни углеводов. Подставлять сюда
                  ноль нельзя — «0.0 : 1» означает блюдо без жира, то есть
                  ровно противоположное тому, что на весах. */}
              <RatioBadge
                ratio={dish.ratio}
                withinTolerance={
                  stale
                    ? undefined
                    : (verify.data?.ratio_within_tolerance ?? undefined)
                }
              />
              <span className="tabular-nums">
                {t("calculator.kcalValue", { kcal: dish.kcal.toFixed(0) })}
              </span>
              <KcalDelta
                dish={dish.kcal}
                goal={goal}
                within={stale ? undefined : verify.data?.kcal_within_tolerance}
              />
            </div>

            <Verdict
              stale={stale}
              ratioOk={verify.data?.ratio_within_tolerance}
              kcalOk={verify.data?.kcal_within_tolerance}
            />

            <MacroBar
              fatG={dish.fat_g}
              proteinG={dish.protein_g}
              carbsG={dish.carbs_g}
              netCarbs={{
                grams: dish.net_carbs_g,
                label: t("calculator.netCarbs"),
                note: t("calculator.netCarbsNote"),
              }}
            />
          </div>
        )}

        <Separator />

        {/* Два действия, и у каждого свой ввод прямо над ним (правило П9
            канона). Подбор первый и крупный: это главное, чего нет у системы,
            в которой клиника работает сегодня, — там граммовку доводят
            стрелками вручную. */}
        <div className="flex items-start gap-field">
          <NumberField
            id="protein-min"
            label={t("calculator.proteinMin")}
            value={proteinMin}
            onChange={setProteinMin}
          />
          <NumberField
            id="carbs-max"
            label={t("calculator.carbsMax")}
            value={carbsMax}
            onChange={setCarbsMax}
          />
        </div>
        <p className="m-0 text-sm text-muted-foreground">
          {t("calculator.limitsHint")}
        </p>
        <Button
          type="button"
          className="min-h-(--spacing-touch) w-full"
          disabled={solveBlockedBy !== null || busy}
          aria-busy={solve.isPending}
          aria-describedby={solveBlockedBy === null ? undefined : reasonId}
          onClick={() => {
            if (solveTargets === null) return;
            scale.reset();
            solve.mutate({ rows, targets: solveTargets });
          }}
        >
          {solve.isPending
            ? t("calculator.calculating")
            : t("calculator.doSolve")}
        </Button>

        <div className="flex items-end gap-field">
          <NumberField
            id="factor"
            label={t("calculator.factor")}
            value={factor}
            onChange={(value) => {
              setFactor(value);
              scale.reset();
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-(--spacing-touch) flex-1"
            disabled={scaleBlockedBy !== null || busy}
            aria-busy={scale.isPending}
            aria-describedby={scaleBlockedBy === null ? undefined : reasonId}
            onClick={() => {
              solve.reset();
              scale.mutate({ rows, factor: parseAmount(factor) });
            }}
          >
            {scale.isPending
              ? t("calculator.calculating")
              : t("calculator.doScale")}
          </Button>
        </div>
        {/* Область постоянна: живая область, появившаяся вместе с текстом,
            озвучивается не всеми программами чтения с экрана. */}
        <ActionReason id={reasonId}>{actionsBlockedBy}</ActionReason>
        <p className="m-0 text-sm text-muted-foreground">
          {t("calculator.factorHint")}
        </p>
      </Section>

      {/* Неразрешимая задача — не ошибка, а объяснимый результат (раздел 8.3
          ТЗ): сервер возвращает человекочитаемую причину, её и показываем. */}
      {/* Отказ действия, дословно повторяющий видимый отказ проверки, — второй
          красный баннер с тем же текстом (правило П27). «Недостижимо» остаётся
          всегда: это самостоятельный ответ. */}
      {actionError !== null &&
        actionError !== undefined &&
        (infeasible || !duplicateOfVerify) && (
          <WarningBanner
            level="danger"
            title={
              infeasible
                ? t("calculator.infeasible")
                : t("calculator.actionFailed")
            }
          >
            {errorMessageOf(actionError) ?? t("calculator.errorHint")}
          </WarningBanner>
        )}

      {/* Причина отказа — текстом сервера, как в кабинете (ADR-0028: экраны
          одинаковые). Общая подсказка скрывала её, и после пересчёта порций в
          массы, которые расчёт не принимает, семья не узнавала, что не так.
          Пока правка не догнала расчёт, прежний отказ не показывается. */}
      {verifyShown && (
        <WarningBanner level="danger" title={t("calculator.error")}>
          {errorMessageOf(verify.error) ?? t("calculator.errorHint")}
        </WarningBanner>
      )}
    </main>
  );
}

/**
 * Названия исключённых продуктов, а не идентификаторы: продукт могли удалить из
 * справочника, и 36 знаков UUID семье не говорят ничего (находка М6, тот же
 * класс, что Н1 кабинета).
 */
function namesOf(
  entries: { product_id: string; name_ru?: string | null }[],
  t: (key: string) => string,
) {
  return entries
    .map((item) => item.name_ru ?? t("calculator.unknownProduct"))
    .join(", ");
}

/**
 * Числовое поле: метка над полем (правило П6 канона).
 *
 * Метка слева от поля, как было раньше, годится для одиночного ввода, но пары
 * «соотношение / калорийность» и «белок / углеводы» так не поставить, а стоять
 * они обязаны рядом: сложенные в столбик, они отодвигают показатели блюда за
 * сгиб телефона.
 */
function NumberField({
  id,
  label,
  value,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        className="tabular-nums"
        value={value}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="m-0 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * На сколько блюдо мимо цели по калориям.
 *
 * Соотношение показывает значок, а «на сколько промахнулись по калориям»
 * иначе приходится считать в уме — с телефона у плиты особенно.
 */
function KcalDelta({
  dish,
  goal,
  within,
}: {
  dish: number;
  goal: Targets | null;
  within: boolean | null | undefined;
}) {
  const { t } = useTranslation();

  if (goal === null) return null;
  const delta = Math.round(dish - goal.kcal);
  if (delta === 0) return null;

  return (
    <span
      className={cn(
        "text-sm tabular-nums",
        within === false ? "text-warning" : "text-muted-foreground",
      )}
    >
      {t(delta > 0 ? "calculator.above" : "calculator.below", {
        value: Math.abs(delta),
      })}
    </span>
  );
}

/**
 * Достигнута ли цель — строкой рядом с числами, а не плашкой-тревогой.
 *
 * Пока блюдо собирают, оно почти всегда мимо цели, и предупреждение на каждом
 * продукте мешает его собирать. Состояние названо словом, а не только цветом
 * (WCAG 1.4.1). Молчание честнее догадки: без цели и на устаревшем расчёте
 * вывода нет вовсе.
 */
function Verdict({
  stale,
  ratioOk,
  kcalOk,
}: {
  stale: boolean;
  ratioOk: boolean | null | undefined;
  kcalOk: boolean | null | undefined;
}): ReactNode {
  const { t } = useTranslation();

  if (stale) {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("calculator.recalculating")}
      </p>
    );
  }

  if (
    ratioOk === null ||
    ratioOk === undefined ||
    kcalOk === null ||
    kcalOk === undefined
  ) {
    return null;
  }

  const within = ratioOk && kcalOk;
  return (
    <p
      role="status"
      className={cn("m-0 text-sm", within ? "text-success" : "text-warning")}
    >
      {t(within ? "calculator.goalMet" : "calculator.goalMissed")}
    </p>
  );
}

function ProductPicker({
  onPick,
}: {
  onPick: (product: ProductOption) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, RECALC_DELAY_MS);
  const found = useProductSearch(debounced);

  return (
    <div className="flex flex-col gap-field">
      <Input
        type="search"
        placeholder={t("calculator.search")}
        aria-label={t("calculator.search")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {debounced.trim().length >= MIN_QUERY && (
        <ul className="flex flex-col">
          {(found.data ?? []).map((product) => (
            <li key={product.id}>
              <button
                type="button"
                className="min-h-(--spacing-touch) w-full text-left"
                onClick={() => {
                  onPick(product);
                  setQuery("");
                }}
              >
                {product.name}
              </button>
            </li>
          ))}
          {found.data?.length === 0 && (
            <li className="text-muted-foreground">
              {t("calculator.nothingFound")}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
