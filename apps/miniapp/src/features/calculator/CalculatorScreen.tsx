import {
  AsyncSection,
  Button,
  Input,
  RatioBadge,
  Section,
  WarningBanner,
} from "@ketocare/ui";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { Session } from "../session/useSession";
import { usePatientOverview } from "../home/useOverview";
import {
  MIN_QUERY,
  type DishRow,
  type ProductOption,
  type Targets,
  useProductSearch,
  useVerify,
} from "./useCalculator";

/** Та же задержка, что у поисковых полей: правка граммовки — несколько нажатий. */
const RECALC_DELAY_MS = 400;

/**
 * Калькулятор, режим «Проверить» (раздел 9 ТЗ).
 *
 * Подбор и пересчёт рецепта сюда пока не перенесены: они переписывают состав
 * целиком, и на телефоне это отдельный разговор. Проверить, что получилось на
 * весах, — то, ради чего калькулятор открывают у плиты.
 *
 * Целевое соотношение берётся из назначения ребёнка, а не из зашитой четвёрки.
 * Целевая калорийность приёма остаётся за человеком: разложить суточную норму
 * по приёмам — решение врача, а не деление на число приёмов (вопрос 24 в
 * `docs/medical/OPEN_QUESTIONS.md`).
 */
export function CalculatorScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DishRow[]>([]);
  const [kcal, setKcal] = useState("");

  const overview = usePatientOverview(session.patientId);
  const prescribedRatio = overview.data?.prescription?.ratio ?? null;

  // Ссылка на цели обязана быть постоянной между отрисовками: `stale` ниже
  // сравнивает её с задержанной копией по ссылке, и новый объект на каждый
  // рендер держал бы вердикт снятым навсегда — экран вечно «пересчитываем».
  const targets: Targets | null = useMemo(
    () =>
      prescribedRatio !== null && Number(kcal) > 0
        ? { ratio: prescribedRatio, kcal: Number(kcal) }
        : null,
    [prescribedRatio, kcal],
  );

  const debouncedRows = useDebouncedValue(rows, RECALC_DELAY_MS);
  const debouncedTargets = useDebouncedValue(targets, RECALC_DELAY_MS);
  const verify = useVerify(session.patientId, debouncedRows, debouncedTargets);

  /**
   * Показанное посчитано не по тому, что сейчас в полях.
   *
   * Число остаётся на экране — гасить его на каждое нажатие значит очищать то,
   * по чему человек сверяется. А вердикт снимается: «в допуске», посчитанное
   * при прежней граммовке, рядом с новым числом — не устаревшая выдача, а
   * неверное утверждение, и по нему готовят еду ребёнку.
   */
  const stale =
    rows !== debouncedRows || targets !== debouncedTargets || verify.isFetching;

  return (
    <main className="flex flex-col gap-block p-block">
      <h1 className="text-page-title">{t("calculator.title")}</h1>

      <Section title={t("calculator.composition")} density="compact">
        <ul className="flex flex-col gap-field">
          {rows.map((row, index) => (
            <li key={row.product.id} className="flex items-center gap-field">
              <span className="flex-1">{row.product.name}</span>
              <Input
                type="number"
                inputMode="decimal"
                className="w-24"
                aria-label={t("calculator.grams", { name: row.product.name })}
                value={row.grams === 0 ? "" : String(row.grams)}
                onChange={(event) => {
                  const grams = Number(event.target.value);
                  setRows(
                    rows.map((r, i) => (i === index ? { ...r, grams } : r)),
                  );
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("calculator.remove", { name: row.product.name })}
                onClick={() => {
                  setRows(rows.filter((_, i) => i !== index));
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
                : [...current, { product, grams: 0 }],
            );
          }}
        />
      </Section>

      {/* Результат сразу под составом: на телефоне всё, что ниже, — за сгибом,
          и правка граммовки выглядела бы как «ничего не происходит». */}
      <Section title={t("calculator.result")} density="compact">
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
            <div className="flex flex-col gap-field">
              <div className="flex flex-wrap items-center gap-field">
                {/* `ratio` приходит пустым, когда делить не на что: в блюде из
                    одного масла нет ни белка, ни углеводов. Подставлять сюда
                    ноль нельзя — «0.0 : 1» означает блюдо без жира, то есть
                    ровно противоположное тому, что на весах. Значок сам умеет
                    показывать «не определено». */}
                <RatioBadge
                  ratio={verify.data.dish.ratio}
                  withinTolerance={
                    stale
                      ? undefined
                      : (verify.data.ratio_within_tolerance ?? undefined)
                  }
                />
                <span>
                  {t("calculator.kcalValue", {
                    kcal: round(verify.data.dish.kcal),
                  })}
                </span>
              </div>
              <p className="text-muted-foreground">
                {t("calculator.macros", {
                  fat: round(verify.data.dish.fat_g),
                  protein: round(verify.data.dish.protein_g),
                  carbs: round(verify.data.dish.carbs_g),
                })}
              </p>

              {verify.data.excluded.length > 0 && (
                <WarningBanner level="danger" title={t("calculator.excluded")}>
                  {verify.data.excluded
                    .map((item) => item.name_ru ?? item.product_id)
                    .join(", ")}
                </WarningBanner>
              )}

              {stale ? (
                <p className="text-muted-foreground">
                  {t("calculator.recalculating")}
                </p>
              ) : (
                <Verdict
                  ratioOk={verify.data.ratio_within_tolerance}
                  kcalOk={verify.data.kcal_within_tolerance}
                />
              )}
            </div>
          )}
        </AsyncSection>
      </Section>

      <Section title={t("calculator.targets")} density="compact">
        <p className="text-muted-foreground">
          {prescribedRatio === null
            ? t("calculator.noPrescription")
            : t("calculator.ratioFromPrescription", { ratio: prescribedRatio })}
        </p>
        <label className="flex items-center gap-field">
          <span className="flex-1">{t("calculator.mealKcal")}</span>
          <Input
            type="number"
            inputMode="numeric"
            className="w-28"
            value={kcal}
            onChange={(event) => {
              setKcal(event.target.value);
            }}
          />
        </label>
        <p className="text-muted-foreground">{t("calculator.mealKcalHint")}</p>
      </Section>
    </main>
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

function round(value: number): string {
  return value.toFixed(1);
}
