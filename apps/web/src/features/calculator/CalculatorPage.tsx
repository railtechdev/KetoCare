import {
  Button,
  Section,
  Tabs,
  TabsBar,
  TabsContent,
  WarningBanner,
} from "@ketocare/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { useSectionItem, useSectionTab } from "../../routes/useSectionTab";
import { usePatientOverview } from "../patients/overview";
import { DishResultView, type DishView } from "./DishResultView";
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

type Mode = "verify" | "solve" | "scale";

const MODES = ["verify", "solve", "scale"] as const;

/**
 * Цели по умолчанию, пока назначение не загрузилось.
 *
 * Кетосоотношение подставляется из активного назначения ребёнка, как только оно
 * придёт: до этого калькулятор сравнивал блюдо с четвёркой, зашитой в экране, и
 * объявлял «выходит за допуски назначения» — вердикт относительно чужой цели.
 *
 * Калорийность приёма остаётся за пользователем. Разделить суточную норму на
 * число приёмов — медицинское допущение о равномерном распределении, а его
 * принимает не фронтенд (правило 1 CLAUDE.md).
 * TODO(med): вопрос 24 в `docs/medical/OPEN_QUESTIONS.md`.
 */
const DEFAULT_TARGETS: TargetsInput = { ratio: 4, kcal: 400 };

/** Калькулятор: три режима из раздела 8.3 ТЗ. */
export function CalculatorPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("calculator");

  // Режим — в адресе (правило П30): ссылку на «подобрать раскладку» можно
  // переслать, а F5 не возвращает в «проверить».
  const [mode, setMode] = useSectionTab<Mode>("tab", MODES, "verify");
  const [rows, setRows] = useState<DishRow[]>([]);

  // Продукт, пришедший из справочника (`?item=<id>`). Справочник знает только
  // идентификатор, состав на 100 г нужно дочитать. До этого справочник и
  // калькулятор не знали друг о друге: найденный продукт приходилось искать
  // здесь заново по памяти.
  const [incomingId, setIncomingId] = useSectionItem();
  const incoming = useProduct(incomingId);
  const [targets, setTargets] = useState<TargetsInput>(DEFAULT_TARGETS);
  const [factor, setFactor] = useState(2);

  // Назначение — тем же запросом, что у главной и меню: свой запрос делил бы
  // с ними ключ, но расходился бы в обработке.
  const overview = usePatientOverview(patientId);
  const prescribedRatio = overview.data?.prescription?.ratio ?? null;

  // Правка пользователя важнее назначения: он мог считать блюдо под другую
  // цель осознанно, и подставлять назначение поверх введённого значит терять
  // его ввод.
  const [ratioTouched, setRatioTouched] = useState(false);

  useEffect(() => {
    if (prescribedRatio === null || ratioTouched) return;
    setTargets((current) =>
      current.ratio === prescribedRatio
        ? current
        : { ...current, ratio: prescribedRatio },
    );
  }, [prescribedRatio, ratioTouched]);

  useEffect(() => {
    const product = incoming.data;
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
  }, [incoming.data, setIncomingId]);

  const verify = useVerifyMutation();
  const solve = useSolveMutation();
  const scale = useScaleMutation();

  const active = mode === "verify" ? verify : mode === "solve" ? solve : scale;

  /**
   * Массы, которые вернул сервер.
   *
   * В режиме «подобрать» их задаёт решатель, в режиме «пересчитать» —
   * множитель порции. И там и там на экране обязаны стоять новые граммовки:
   * родитель по этому экрану взвешивает продукты.
   *
   * До этого пересчёт показывал итоги новой порции, а состав оставался от
   * старой — и в сохранение уходил тоже старый. Родитель, сохранивший
   * «двойную порцию», получал блюдо с одинарной раскладкой и расхождение
   * замечал, только сложив макросы вручную.
   */
  // Только «пересчитать»: подобранные массы теперь уезжают прямо в состав
  // (см. ниже), и второй их список был бы копией того, что уже в полях.
  const serverItems = mode === "scale" ? scale.data?.dish.items : undefined;

  const serverRows: DishRow[] = (serverItems ?? []).flatMap((item) => {
    const row = rows.find((r) => r.product.id === item.product_id);
    return row ? [{ ...row, grams: item.grams }] : [];
  });

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

  // Подобранная раскладка переносится в состав.
  //
  // До этого массы решателя жили только внутри ответа мутации: поля были
  // заблокированы, а переход на другую вкладку сбрасывал результат и возвращал
  // исходные 50 г. Цепочка «подобрал → округлил под кухонные весы → проверил →
  // пересчитал на две порции» была разорвана: из режима «подобрать» вёл один
  // выход — сохранить как есть, иначе результат исчезал.
  const solvedItems = solve.data?.dish.items;
  useEffect(() => {
    if (solvedItems === undefined) return;
    const grams = new Map(
      solvedItems.map((item) => [item.product_id, item.grams]),
    );
    setRows((current) =>
      current.map((row) => {
        const next = grams.get(row.product.id);
        return next === undefined || next === row.grams
          ? row
          : { ...row, grams: next };
      }),
    );
  }, [solvedItems]);

  const infeasible = errorCodeOf(solve.error) === "infeasible_calculation";
  // Сохраняется то, что показано: расчётные массы, если сервер их вернул.
  const rowsForSave = serverRows.length > 0 ? serverRows : rows;

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
          rows={rows}
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
          <ScaleFields
            factor={factor}
            onChange={(next) => {
              setFactor(next);
              resetResults();
            }}
          />
        ) : (
          <TargetsFields
            targets={targets}
            prescribedRatio={prescribedRatio}
            onChange={(next) => {
              if (next.ratio !== targets.ratio) setRatioTouched(true);
              setTargets(next);
              // Вердикт относится к тем целям, при которых его посчитали:
              // зелёный значок от прежнего соотношения рядом с новым числом в
              // поле опаснее обычной устаревшей выдачи — по нему готовят.
              resetResults();
            }}
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

          {/* Пересчитанные граммовки — отдельным блоком, а не подменой ввода:
              исходные массы остаются доступными для правки, потому что они и
              есть ввод этого режима. В «подобрать» иначе — там массы задаёт
              решатель, и править их бессмысленно. */}
          {mode === "scale" && serverRows.length > 0 && (
            <Section
              title={t("scaled.title")}
              description={t("scaled.description", { factor })}
              level={2}
            >
              <DishRows rows={serverRows} readOnlyGrams />
            </Section>
          )}

          <SaveDishForm patientId={patientId} rows={rowsForSave} />
        </>
      )}
    </PageLayout>
  );
}

function TargetsFields({
  targets,
  prescribedRatio,
  onChange,
  showLimits,
}: {
  targets: TargetsInput;
  /** Соотношение из активного назначения; null — назначения нет или не пришло */
  prescribedRatio: number | null;
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
        width="narrow"
        label={t("targets.ratio")}
        // Откуда взялось значение — видно прямо у поля: молча подставленное
        // назначение неотличимо от значения, введённого в прошлый раз.
        hint={
          prescribedRatio === null
            ? t("targets.ratioNoPrescription")
            : targets.ratio === prescribedRatio
              ? t("targets.ratioFromPrescription", { value: prescribedRatio })
              : t("targets.ratioOverridden", { value: prescribedRatio })
        }
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
        width="narrow"
        label={t("targets.kcal")}
        // Из назначения не подставляется: суточная норма делится на приёмы
        // только при допущении о равномерном распределении, а это решение
        // медицинской команды (вопрос 24 в OPEN_QUESTIONS).
        hint={t("targets.kcalHint")}
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
            width="narrow"
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
            width="narrow"
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
        width="narrow"
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
