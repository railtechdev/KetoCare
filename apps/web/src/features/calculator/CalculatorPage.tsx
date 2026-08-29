import {
  Button,
  Section,
  Tabs,
  TabsBar,
  TabsContent,
  WarningBanner,
} from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { useSectionTab } from "../../routes/useSectionTab";
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

const MODES = ["verify", "solve", "scale"] as const;

const DEFAULT_TARGETS: TargetsInput = { ratio: 4, kcal: 400 };

/** Калькулятор: три режима из раздела 8.3 ТЗ. */
export function CalculatorPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("calculator");

  // Режим — в адресе (правило П30): ссылку на «подобрать раскладку» можно
  // переслать, а F5 не возвращает в «проверить».
  const [mode, setMode] = useSectionTab<Mode>("tab", MODES, "verify");
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
    <PageLayout title={t("title")} intro={t("intro")}>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value as Mode);
          resetResults();
        }}
      >
        <TabsBar
          label={t("tabsLabel")}
          items={MODES.map((value) => ({ value, label: t(`tabs.${value}`) }))}
        />

        {MODES.map((value) => (
          <TabsContent key={value} value={value}>
            <p className="m-0 text-sm text-muted-foreground">
              {t(`tabHint.${value}`)}
            </p>
          </TabsContent>
        ))}
      </Tabs>

      <Section
        title={t("composition.title")}
        description={t("composition.description")}
      >
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
      </Section>

      <Section title={t("params.title")}>
        {mode === "scale" ? (
          <ScaleFields factor={factor} onChange={setFactor} />
        ) : (
          <TargetsFields
            targets={targets}
            onChange={setTargets}
            showLimits={mode === "solve"}
          />
        )}

        {/* Кнопка расчёта — внутри блока параметров, а не голой в корне
            страницы: она действует над тем, что над ней, и была единственным
            таким местом в приложении (правило П31). */}
        <Button
          type="button"
          size="lg"
          onClick={run}
          disabled={rows.length === 0 || active.isPending}
          aria-busy={active.isPending}
          className="min-h-touch w-full sm:w-auto sm:self-start"
        >
          {active.isPending ? t("calculating") : t("calculate")}
        </Button>
      </Section>

      {/* Неразрешимая задача — не ошибка, а объяснимый результат (раздел 8.3 ТЗ):
          сервер возвращает человекочитаемую причину, её и показываем. */}
      {infeasible && (
        <WarningBanner level="danger" title={t("infeasible.title")}>
          {errorMessageOf(solve.error)}
        </WarningBanner>
      )}

      {/* Расчёт запускает пользователь — это отправка, а не загрузка экрана,
          поэтому ошибка показывается как ошибка действия (П16 канона). */}
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
    </PageLayout>
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
  // inputMode="decimal": на телефоне открывается цифровая клавиатура (П13).
  return (
    <div className="grid gap-block sm:grid-cols-2">
      <Field
        id="ratio"
        label={t("targets.ratio")}
        type="number"
        inputMode="decimal"
        min={1}
        max={5}
        step={0.5}
        value={targets.ratio}
        onChange={(e) =>
          onChange({ ...targets, ratio: Number(e.target.value) })
        }
        className="tabular-nums"
      />
      <Field
        id="kcal"
        label={t("targets.kcal")}
        type="number"
        inputMode="decimal"
        min={1}
        step={10}
        value={targets.kcal}
        onChange={(e) => onChange({ ...targets, kcal: Number(e.target.value) })}
        className="tabular-nums"
      />

      {showLimits && (
        <>
          <Field
            id="protein-min"
            label={t("targets.proteinMin")}
            optional
            type="number"
            inputMode="decimal"
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
            className="tabular-nums"
          />
          <Field
            id="carbs-max"
            label={t("targets.carbsMax")}
            optional
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={targets.carbsMax ?? ""}
            onChange={(e) =>
              onChange({
                ...targets,
                carbsMax: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            className="tabular-nums"
          />
        </>
      )}
    </div>
  );
}

function ScaleFields({
  factor,
  onChange,
}: {
  factor: number;
  onChange: (next: number) => void;
}) {
  const { t } = useTranslation("calculator");

  return (
    <div className="grid gap-block sm:grid-cols-2">
      <Field
        id="factor"
        label={t("factor")}
        hint={t("factorHint")}
        type="number"
        inputMode="decimal"
        min={0.1}
        step={0.1}
        value={factor}
        onChange={(event) => onChange(Number(event.target.value))}
        className="tabular-nums"
      />
    </div>
  );
}
