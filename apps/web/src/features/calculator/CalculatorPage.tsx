import * as Tabs from "@radix-ui/react-tabs";
import { WarningBanner, cn } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FIELD_CONTROL } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { DishResultView, type DishView } from "./DishResultView";
import { DishRows } from "./DishRows";
import { ProductPicker } from "./ProductPicker";
import { SaveDishForm } from "./SaveDishForm";
import type { DishRow } from "./types";
import {
  useScaleMutation,
  useSolveMutation,
  useVerifyMutation,
  type TargetsInput,
} from "./useCalcMutations";

type Mode = "verify" | "solve" | "scale";

const DEFAULT_TARGETS: TargetsInput = { ratio: 4, kcal: 400 };

/** Калькулятор: три режима из раздела 8.3 ТЗ. */
export function CalculatorPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("calculator");

  const [mode, setMode] = useState<Mode>("verify");
  const [rows, setRows] = useState<DishRow[]>([]);
  const [targets, setTargets] = useState<TargetsInput>(DEFAULT_TARGETS);
  const [factor, setFactor] = useState(2);

  const verify = useVerifyMutation();
  const solve = useSolveMutation();
  const scale = useScaleMutation();

  const active = mode === "verify" ? verify : mode === "solve" ? solve : scale;

  // Массы в режиме «подобрать» задаёт решатель — их возвращает ответ сервера.
  const solvedRows: DishRow[] =
    mode === "solve" && solve.data
      ? solve.data.dish.items.flatMap((item) => {
          const row = rows.find((r) => r.product.id === item.product_id);
          return row ? [{ ...row, grams: item.grams }] : [];
        })
      : [];

  const dish: DishView | null = active.data
    ? ((active.data as { dish: DishView }).dish ?? null)
    : null;

  const ratioWithin =
    mode === "solve"
      ? solve.data?.ratio_within_tolerance
      : mode === "verify"
        ? (verify.data?.ratio_within_tolerance ?? undefined)
        : undefined;
  const kcalWithin =
    mode === "solve"
      ? solve.data?.kcal_within_tolerance
      : mode === "verify"
        ? (verify.data?.kcal_within_tolerance ?? undefined)
        : undefined;

  function resetResults() {
    verify.reset();
    solve.reset();
    scale.reset();
  }

  function run() {
    if (mode === "verify") verify.mutate({ rows, targets });
    else if (mode === "solve") solve.mutate({ rows, targets });
    else scale.mutate({ rows, factor });
  }

  const infeasible = errorCodeOf(solve.error) === "infeasible_calculation";
  const rowsForSave = mode === "solve" ? solvedRows : rows;

  return (
    <section className="flex flex-col gap-6">
      <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>

      <Tabs.Root
        value={mode}
        onValueChange={(value) => {
          setMode(value as Mode);
          resetResults();
        }}
      >
        <Tabs.List className="flex gap-2 border-b border-border">
          {(["verify", "solve", "scale"] as const).map((value) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="min-h-touch px-4 text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold"
            >
              {t(`tabs.${value}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {(["verify", "solve", "scale"] as const).map((value) => (
          <Tabs.Content key={value} value={value} className="pt-4">
            <p className="mt-0 text-muted-foreground">
              {t(`tabHint.${value}`)}
            </p>
          </Tabs.Content>
        ))}
      </Tabs.Root>

      <ProductPicker
        excludeIds={rows.map((r) => r.product.id)}
        onPick={(product) => {
          setRows((current) => [...current, { product, grams: 50 }]);
          resetResults();
        }}
      />

      <DishRows
        rows={mode === "solve" && solvedRows.length > 0 ? solvedRows : rows}
        readOnlyGrams={mode === "solve" && solvedRows.length > 0}
        onChangeGrams={(productId, grams) => {
          setRows((current) =>
            current.map((row) =>
              row.product.id === productId ? { ...row, grams } : row,
            ),
          );
          resetResults();
        }}
        onRemove={(productId) => {
          setRows((current) =>
            current.filter((row) => row.product.id !== productId),
          );
          resetResults();
        }}
      />

      {mode !== "scale" && (
        <TargetsFields
          targets={targets}
          onChange={setTargets}
          showLimits={mode === "solve"}
        />
      )}

      {mode === "scale" && (
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="factor">
            {t("factor")}
          </label>
          <input
            id="factor"
            type="number"
            min={0.1}
            step={0.1}
            value={factor}
            onChange={(event) => setFactor(Number(event.target.value))}
            className="min-h-touch w-40 rounded-lg border border-border bg-card px-3 py-2 tabular-nums"
          />
        </div>
      )}

      <button
        type="button"
        onClick={run}
        disabled={rows.length === 0 || active.isPending}
        className="min-h-touch w-full max-w-xs rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60"
      >
        {active.isPending ? t("calculating") : t("calculate")}
      </button>

      {/* Неразрешимая задача — не ошибка, а объяснимый результат (раздел 8.3 ТЗ):
          сервер возвращает человекочитаемую причину, её и показываем. */}
      {infeasible && (
        <WarningBanner level="danger" title={t("infeasible.title")}>
          {errorMessageOf(solve.error)}
        </WarningBanner>
      )}

      {active.isError && !infeasible && (
        <FormError>
          {errorMessageOf(active.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {dish && (
        <>
          <DishResultView
            dish={dish}
            ratioWithinTolerance={ratioWithin ?? undefined}
            kcalWithinTolerance={kcalWithin ?? undefined}
          />
          <SaveDishForm patientId={patientId} rows={rowsForSave} />
        </>
      )}
    </section>
  );
}

function TargetsFields({
  targets,
  onChange,
  showLimits,
}: {
  targets: TargetsInput;
  onChange: (next: TargetsInput) => void;
  showLimits: boolean;
}) {
  const { t } = useTranslation("calculator");

  // tabular-nums: цифры в полях цели не должны прыгать при вводе.
  const field = cn(FIELD_CONTROL, "tabular-nums");

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="ratio">
          {t("targets.ratio")}
        </label>
        <input
          id="ratio"
          type="number"
          min={1}
          max={5}
          step={0.5}
          value={targets.ratio}
          onChange={(e) =>
            onChange({ ...targets, ratio: Number(e.target.value) })
          }
          className={field}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="kcal">
          {t("targets.kcal")}
        </label>
        <input
          id="kcal"
          type="number"
          min={1}
          step={10}
          value={targets.kcal}
          onChange={(e) =>
            onChange({ ...targets, kcal: Number(e.target.value) })
          }
          className={field}
        />
      </div>

      {showLimits && (
        <>
          <div>
            <label
              className="mb-1.5 block text-sm font-medium"
              htmlFor="protein-min"
            >
              {t("targets.proteinMin")}{" "}
              <span className="font-normal text-muted-foreground">
                ({t("targets.optional")})
              </span>
            </label>
            <input
              id="protein-min"
              type="number"
              min={0}
              step={1}
              value={targets.proteinMin ?? ""}
              onChange={(e) =>
                onChange({
                  ...targets,
                  proteinMin:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className={field}
            />
          </div>
          <div>
            <label
              className="mb-1.5 block text-sm font-medium"
              htmlFor="carbs-max"
            >
              {t("targets.carbsMax")}{" "}
              <span className="font-normal text-muted-foreground">
                ({t("targets.optional")})
              </span>
            </label>
            <input
              id="carbs-max"
              type="number"
              min={0}
              step={1}
              value={targets.carbsMax ?? ""}
              onChange={(e) =>
                onChange({
                  ...targets,
                  carbsMax:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className={field}
            />
          </div>
        </>
      )}
    </div>
  );
}
