import {
  AsyncSection,
  Button,
  Input,
  RatioBadge,
  Section,
  Tabs,
  TabsBar,
  TabsContent,
  WarningBanner,
} from "@ketocare/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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

const MODES = ["verify", "solve", "scale"] as const;
type Mode = (typeof MODES)[number];

/**
 * Калькулятор: три режима раздела 9 ТЗ.
 *
 * «Проверить» считает сам по мере правки — это то, ради чего калькулятор
 * открывают у плиты. «Подобрать» и «Пересчитать» ПЕРЕЗАПИСЫВАЮТ граммовку,
 * поэтому их запускает кнопка: расчёт по ходу набора вырывал бы поля из-под
 * пальцев.
 *
 * Режим держится в состоянии, а не в адресе (правило П30 канона): у Mini App
 * нет ни роутера, ни видимой адресной строки — переслать ссылку на вкладку
 * некуда, и хранить её негде.
 *
 * Целевое соотношение берётся из назначения ребёнка, а не из зашитой четвёрки.
 * Целевая калорийность приёма остаётся за человеком: разложить суточную норму
 * по приёмам — решение врача, а не деление на число приёмов (вопрос 24 в
 * `docs/medical/OPEN_QUESTIONS.md`).
 */
export function CalculatorScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("verify");
  const [rows, setRows] = useState<DishRow[]>([]);
  const [kcal, setKcal] = useState("");
  const [proteinMin, setProteinMin] = useState("");
  const [carbsMax, setCarbsMax] = useState("");
  const [factor, setFactor] = useState("2");

  const overview = usePatientOverview(session.patientId);
  const prescribedRatio = overview.data?.prescription?.ratio ?? null;

  // Ссылка на цели обязана быть постоянной между отрисовками: `stale` ниже
  // сравнивает её с задержанной копией по ссылке, и новый объект на каждый
  // рендер держал бы вердикт снятым навсегда — экран вечно «пересчитываем».
  const targets: Targets | null = useMemo(
    () =>
      prescribedRatio !== null && parseAmount(kcal) > 0
        ? {
            ratio: prescribedRatio,
            kcal: parseAmount(kcal),
            // Пределы — только для подбора: в проверке ограничивать нечего,
            // состав уже задан. Пустое поле — это «предела нет», а не ноль:
            // ноль по белку означал бы «белка не должно быть вовсе».
            protein_min_g:
              mode === "solve" && parseAmount(proteinMin) > 0
                ? parseAmount(proteinMin)
                : null,
            carbs_max_g:
              mode === "solve" && parseAmount(carbsMax) > 0
                ? parseAmount(carbsMax)
                : null,
          }
        : null,
    [prescribedRatio, kcal, proteinMin, carbsMax, mode],
  );

  const debouncedRows = useDebouncedValue(rows, RECALC_DELAY_MS);
  const debouncedTargets = useDebouncedValue(targets, RECALC_DELAY_MS);
  // Проверка идёт только в своём режиме: в остальных её запросы уходили бы в
  // пустоту, нагружая ядро на каждое нажатие.
  const verify = useVerify(
    session.patientId,
    mode === "verify" ? debouncedRows : [],
    debouncedTargets,
  );
  const solve = useSolve(session.patientId);
  const scale = useScale();

  /**
   * Подобранная раскладка переносится в состав.
   *
   * Иначе массы решателя жили бы только внутри ответа, и цепочка «подобрал →
   * округлил под кухонные весы → проверил» рвалась бы на первом шаге: из
   * подбора вёл бы один выход — принять как есть.
   */
  const solvedItems = solve.data?.dish.items;
  useEffect(() => {
    if (solvedItems === undefined) return;
    const grams = new Map(
      solvedItems.map((item) => [item.product_id, item.grams]),
    );
    setRows((current) =>
      current.map((row) => {
        const next = grams.get(row.product.id);
        return next === undefined ? row : { ...row, grams: format(next) };
      }),
    );
  }, [solvedItems]);

  /**
   * Показанное посчитано не по тому, что сейчас в полях.
   *
   * Число остаётся на экране — гасить его на каждое нажатие значит очищать то,
   * по чему человек сверяется. А вердикт снимается: «в допуске», посчитанное
   * при прежней граммовке, рядом с новым числом — не устаревшая выдача, а
   * неверное утверждение, и по нему готовят еду ребёнку.
   */
  const stale =
    mode === "verify" &&
    (rows !== debouncedRows ||
      targets !== debouncedTargets ||
      verify.isFetching);

  function switchMode(next: Mode) {
    setMode(next);
    // Результат прошлого режима к новому не относится: раскладка, подобранная
    // под цели, и та же раскладка, умноженная на порцию, — разные утверждения.
    solve.reset();
    scale.reset();
  }

  /**
   * Правка состава обесценивает подобранное и пересчитанное.
   *
   * «Проверить» пересчитывается само и результат не гасит — там число живёт
   * доли секунды до нового. Здесь пересчёт запускает человек, и итог прежней
   * раскладки рядом с новым составом — не устаревшая выдача, а утверждение о
   * блюде, которого на экране уже нет.
   */
  function dropStaleResults() {
    solve.reset();
    scale.reset();
  }

  const filled =
    rows.length > 0 && rows.every((row) => parseAmount(row.grams) > 0);
  const canSolve = rows.length > 0 && targets !== null && !solve.isPending;
  const canScale = filled && parseAmount(factor) > 0 && !scale.isPending;

  return (
    <main className="flex flex-col gap-block p-block">
      <h1 className="text-page-title">{t("calculator.title")}</h1>

      <Tabs
        value={mode}
        onValueChange={(value) => {
          switchMode(value as Mode);
        }}
      >
        <TabsBar
          label={t("calculator.tabsLabel")}
          items={MODES.map((value) => ({
            value,
            label: t(`calculator.tabs.${value}`),
          }))}
        />
        {MODES.map((value) => (
          <TabsContent key={value} value={value}>
            <p className="m-0 text-sm text-muted-foreground">
              {t(`calculator.tabHint.${value}`)}
            </p>
          </TabsContent>
        ))}
      </Tabs>

      <Section title={t("calculator.composition")} density="compact">
        <ul className="flex flex-col gap-field">
          {rows.map((row, index) => (
            <li key={row.product.id} className="flex items-center gap-field">
              <span className="flex-1">{row.product.name}</span>
              <Input
                type="text"
                inputMode="decimal"
                className="w-24"
                aria-label={t("calculator.grams", { name: row.product.name })}
                value={row.grams}
                onChange={(event) => {
                  const grams = event.target.value;
                  setRows(
                    rows.map((r, i) => (i === index ? { ...r, grams } : r)),
                  );
                  dropStaleResults();
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("calculator.remove", { name: row.product.name })}
                onClick={() => {
                  setRows(rows.filter((_, i) => i !== index));
                  dropStaleResults();
                }}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>

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
      </Section>

      {/* Результат сразу под составом: на телефоне всё, что ниже, — за сгибом,
          и правка граммовки выглядела бы как «ничего не происходит». */}
      <Section title={t("calculator.result")} density="compact">
        {mode === "verify" ? (
          <AsyncSection
            loading={verify.isPending && rows.length > 0}
            skeleton={null}
            error={
              verify.isError
                ? {
                    title: t("calculator.error"),
                    description: t("calculator.errorHint"),
                  }
                : null
            }
            retryLabel={t("actions.retry")}
            onRetry={() => void verify.refetch()}
            isEmpty={rows.length === 0}
            empty={
              <p className="text-muted-foreground">{t("calculator.empty")}</p>
            }
          >
            {verify.data !== undefined && (
              <DishSummary
                dish={verify.data.dish}
                stale={stale}
                ratioOk={stale ? undefined : verify.data.ratio_within_tolerance}
                excluded={verify.data.excluded}
                excludedTitle={t("calculator.excluded")}
                verdict={
                  stale ? (
                    <p className="text-muted-foreground">
                      {t("calculator.recalculating")}
                    </p>
                  ) : (
                    <Verdict
                      ratioOk={verify.data.ratio_within_tolerance}
                      kcalOk={verify.data.kcal_within_tolerance}
                    />
                  )
                }
              />
            )}
          </AsyncSection>
        ) : mode === "solve" ? (
          <ActionResult
            pending={solve.isPending}
            error={solve.error}
            empty={t(
              targets === null
                ? "calculator.solveNeedsTargets"
                : "calculator.solveNotRun",
            )}
            errorTitle={t("calculator.solveFailed")}
          >
            {solve.data !== undefined && (
              <DishSummary
                dish={solve.data.dish}
                ratioOk={solve.data.ratio_within_tolerance}
                excluded={solve.data.excluded}
                // В подборе исключённое не предупреждение, а вычёркивание:
                // сервер снял эти продукты со входа, и человек обязан видеть,
                // что решатель работал не со всем набором.
                excludedTitle={t("calculator.excludedSolve")}
                verdict={
                  <>
                    <p className="text-muted-foreground">
                      {t("calculator.solveApplied")}
                    </p>
                    <Verdict
                      ratioOk={solve.data.ratio_within_tolerance}
                      kcalOk={solve.data.kcal_within_tolerance}
                    />
                  </>
                }
              />
            )}
          </ActionResult>
        ) : (
          <ActionResult
            pending={scale.isPending}
            error={scale.error}
            empty={t("calculator.scaleNotRun")}
            errorTitle={t("calculator.scaleFailed")}
          >
            {scale.data !== undefined && (
              <DishSummary
                dish={scale.data.dish}
                // Вердикта нет и быть не может: пересчёт не сравнивает блюдо с
                // целями приёма — множитель меняет и соотношение цели, и
                // калорийность. Пустое место честнее зелёной строки.
                verdict={
                  <p className="text-muted-foreground">
                    {t("calculator.scaleNoVerdict")}
                  </p>
                }
              />
            )}
          </ActionResult>
        )}
      </Section>

      {mode === "scale" ? (
        <Section title={t("calculator.portion")} density="compact">
          <label className="flex items-center gap-field">
            <span className="flex-1">{t("calculator.factor")}</span>
            <Input
              type="text"
              inputMode="decimal"
              className="w-28"
              value={factor}
              onChange={(event) => {
                setFactor(event.target.value);
                scale.reset();
              }}
            />
          </label>
          <p className="text-muted-foreground">{t("calculator.factorHint")}</p>
          <Button
            type="button"
            className="min-h-(--spacing-touch) w-full"
            disabled={!canScale}
            aria-busy={scale.isPending}
            onClick={() => {
              scale.mutate({ rows, factor: parseAmount(factor) });
            }}
          >
            {scale.isPending
              ? t("calculator.calculating")
              : t("calculator.doScale")}
          </Button>
        </Section>
      ) : (
        <Section title={t("calculator.targets")} density="compact">
          <p className="text-muted-foreground">
            {prescribedRatio === null
              ? t("calculator.noPrescription")
              : t("calculator.ratioFromPrescription", {
                  ratio: prescribedRatio,
                })}
          </p>
          <label className="flex items-center gap-field">
            <span className="flex-1">{t("calculator.mealKcal")}</span>
            <Input
              type="text"
              inputMode="numeric"
              className="w-28"
              value={kcal}
              onChange={(event) => {
                setKcal(event.target.value);
              }}
            />
          </label>
          <p className="text-muted-foreground">
            {t("calculator.mealKcalHint")}
          </p>

          {/* Пределы нужны только подбору: проверке состав задан целиком. */}
          {mode === "solve" && (
            <>
              <label className="flex items-center gap-field">
                <span className="flex-1">{t("calculator.proteinMin")}</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  className="w-28"
                  value={proteinMin}
                  onChange={(event) => {
                    setProteinMin(event.target.value);
                  }}
                />
              </label>
              <label className="flex items-center gap-field">
                <span className="flex-1">{t("calculator.carbsMax")}</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  className="w-28"
                  value={carbsMax}
                  onChange={(event) => {
                    setCarbsMax(event.target.value);
                  }}
                />
              </label>
              <p className="text-muted-foreground">
                {t("calculator.limitsHint")}
              </p>
              <Button
                type="button"
                className="min-h-(--spacing-touch) w-full"
                disabled={!canSolve}
                aria-busy={solve.isPending}
                onClick={() => {
                  if (targets === null) return;
                  scale.reset();
                  solve.mutate({ rows, targets });
                }}
              >
                {solve.isPending
                  ? t("calculator.calculating")
                  : t("calculator.doSolve")}
              </Button>
            </>
          )}
        </Section>
      )}
    </main>
  );
}

/** Итоги блюда: соотношение, калорийность, макросы, исключённое и вердикт. */
function DishSummary({
  dish,
  ratioOk,
  stale,
  excluded,
  excludedTitle,
  verdict,
}: {
  dish: {
    kcal: number;
    fat_g: number;
    protein_g: number;
    carbs_g: number;
    ratio: number | null;
  };
  ratioOk?: boolean | null;
  stale?: boolean;
  excluded?: { product_id: string; name_ru?: string | null }[];
  excludedTitle?: string;
  verdict: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-field">
      <div className="flex flex-wrap items-center gap-field">
        {/* `ratio` приходит пустым, когда делить не на что: в блюде из одного
            масла нет ни белка, ни углеводов. Подставлять сюда ноль нельзя —
            «0.0 : 1» означает блюдо без жира, то есть ровно противоположное
            тому, что на весах. Значок сам умеет показывать «не определено». */}
        <RatioBadge
          ratio={dish.ratio}
          withinTolerance={stale ? undefined : (ratioOk ?? undefined)}
        />
        <span>{t("calculator.kcalValue", { kcal: format(dish.kcal) })}</span>
      </div>
      <p className="text-muted-foreground">
        {t("calculator.macros", {
          fat: format(dish.fat_g),
          protein: format(dish.protein_g),
          carbs: format(dish.carbs_g),
        })}
      </p>

      {excluded !== undefined && excluded.length > 0 && (
        <WarningBanner level="danger" title={excludedTitle}>
          {excluded
            // Словами, а не идентификатором: продукт могли удалить из
            // справочника, и 36 знаков UUID семье не говорят ничего
            // (тот же класс, что находка Н1 кабинета).
            .map((item) => item.name_ru ?? t("calculator.unknownProduct"))
            .join(", ")}
        </WarningBanner>
      )}

      {verdict}
    </div>
  );
}

/**
 * Результат действия, которое запускает человек кнопкой.
 *
 * Отдельно от `AsyncSection`: там четыре состояния блока ДАННЫХ, которые
 * грузятся сами, здесь — отправка (правило П16 канона). Неразрешимая задача
 * при этом не ошибка, а объяснимый результат: сервер возвращает
 * человекочитаемую причину, её и показываем (раздел 8.3 ТЗ).
 */
function ActionResult({
  pending,
  error,
  empty,
  errorTitle,
  children,
}: {
  pending: boolean;
  error: unknown;
  empty: string;
  errorTitle: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  if (pending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t("calculator.calculating")}
      </p>
    );
  }

  if (error !== null && error !== undefined) {
    const infeasible = errorCodeOf(error) === "infeasible_calculation";
    return (
      <WarningBanner
        level="danger"
        title={infeasible ? t("calculator.infeasible") : errorTitle}
      >
        {errorMessageOf(error) ?? t("calculator.errorHint")}
      </WarningBanner>
    );
  }

  const shown = Boolean(children);
  return shown ? (
    <>{children}</>
  ) : (
    <p className="text-muted-foreground">{empty}</p>
  );
}

function Verdict({
  ratioOk,
  kcalOk,
}: {
  ratioOk: boolean | null | undefined;
  kcalOk: boolean | null | undefined;
}) {
  const { t } = useTranslation();

  // Без целей вердикта нет вовсе: сравнивать не с чем, а «всё хорошо» без
  // сравнения — это утверждение из воздуха.
  if (ratioOk === null || ratioOk === undefined) {
    return <p className="text-muted-foreground">{t("calculator.noTargets")}</p>;
  }

  if (ratioOk && kcalOk) {
    return <p className="text-success">{t("calculator.withinTolerance")}</p>;
  }

  return (
    // Соотношение — предупреждение, калорийность — набор: та же граница, что в
    // кабинете (`features/patients/dayVerdict.ts`, вопрос 9 медкоманде).
    <WarningBanner
      level={ratioOk ? "warning" : "danger"}
      title={t("calculator.offTarget")}
    >
      {[
        ratioOk ? null : t("calculator.ratioOff"),
        kcalOk ? null : t("calculator.kcalOff"),
      ]
        .filter(Boolean)
        .join(" ")}
    </WarningBanner>
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

function format(value: number): string {
  return value.toFixed(1);
}
