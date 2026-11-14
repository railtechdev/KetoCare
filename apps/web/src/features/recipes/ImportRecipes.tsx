import {
  ActionReason,
  Badge,
  Button,
  Input,
  Section,
  formatKcal,
  formatMass,
  formatRatio,
  toast,
} from "@ketocare/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { KitSelect } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { ImportProductSearch } from "./ImportProductSearch";
import { RECIPE_CATEGORIES } from "./types";
import {
  useCommitImport,
  useDecideName,
  useEditImportRecipe,
  type ImportDraft,
  type ImportLine,
  type ImportRecipe,
  type ImportRecipeEdit,
} from "./useRecipeImportDraft";

const STATE_BADGE: Record<
  ImportRecipe["state"],
  "default" | "secondary" | "outline"
> = {
  ready: "default",
  needs_work: "outline",
  imported: "secondary",
  skipped: "secondary",
};

/**
 * Рецепты из файла: что готово, что ждёт решения, что уже загружено (ADR-0079).
 *
 * Рядом с каждым рецептом стоит то, что посчитало ядро, — калорийность и
 * кетосоотношение. Это проверка по существу: состав, давший 0,4 : 1 вместо
 * ожидаемых 4 : 1, виден до загрузки. Числа появляются, только когда решены
 * все строки состава: показатели части блюда выглядели бы как показатели блюда.
 *
 * «Принять готовые» загружает то, что готово, и оставляет остальное: большой
 * сборник разбирают в несколько подходов.
 */
export function ImportRecipes({
  draft,
  onOpenRecipe,
}: {
  draft: ImportDraft;
  onOpenRecipe: (recipeId: string) => void;
}) {
  const { t } = useTranslation("recipes");
  const ids = useId();
  const edit = useEditImportRecipe(draft.id);
  const commit = useCommitImport(draft.id);
  const decide = useDecideName(draft.id);

  // Продукт выбирают и отсюда, из состава, — там, где заметили, что его нет.
  // Решение то же, что в списке названий: по названию, для всех рецептов файла.
  function choose(key: string, productId: string) {
    const name = draft.names.find((item) => item.key === key);
    decide.mutate({ key, productId, leftOut: name?.left_out ?? false });
  }
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const pending = draft.items.filter(
    (recipe) => recipe.state === "ready" || recipe.state === "needs_work",
  ).length;

  function toggle(recipeId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  }

  function save(recipeId: string, change: ImportRecipeEdit) {
    edit.mutate({ recipeId, edit: change });
  }

  if (draft.items.length === 0) {
    return (
      <Section title={t("importDraft.recipes.title")}>
        <p className="m-0 text-muted-foreground">
          {draft.status === "parsing"
            ? t("importDraft.status.noRecipesYet")
            : t("importDraft.status.noRecipes")}
        </p>
      </Section>
    );
  }

  return (
    <Section title={t("importDraft.recipes.title")}>
      <div className="flex flex-col items-start gap-field">
        <p className="m-0 tabular-nums">
          {t("importDraft.recipes.summary", {
            ready: draft.ready,
            total: pending,
          })}
        </p>
        <Button
          type="button"
          disabled={draft.ready === 0 || commit.isPending}
          aria-busy={commit.isPending}
          aria-describedby={`${ids}-accept-reason`}
          onClick={() =>
            commit.mutate(draft.items, {
              onSuccess: (result) => {
                if (result.imported > 0) {
                  toast.success(
                    t("importDraft.recipes.accepted", {
                      count: result.imported,
                    }),
                  );
                }
              },
            })
          }
        >
          {commit.isPending
            ? t("importDraft.recipes.accepting")
            : t("importDraft.recipes.accept")}
        </Button>
        <ActionReason id={`${ids}-accept-reason`}>
          {draft.ready === 0 && pending > 0 && !commit.isPending
            ? t("importDraft.recipes.nothingReady")
            : null}
        </ActionReason>
        <p className="m-0 text-sm text-muted-foreground">
          {t("importDraft.recipes.note")}
        </p>
      </div>

      {(commit.isError || edit.isError || decide.isError) && (
        <FormError>
          {errorMessageOf(commit.error ?? edit.error ?? decide.error) ??
            t("common:errors.unexpected")}
        </FormError>
      )}

      <ul className="m-0 flex list-none flex-col gap-field p-0">
        {draft.items.map((recipe) => (
          <li
            key={recipe.id}
            className="flex flex-col gap-2 rounded-md border border-border p-3"
          >
            <RecipeRow
              recipe={recipe}
              open={expanded.has(recipe.id)}
              busy={edit.isPending || decide.isPending}
              onChoose={choose}
              onToggle={() => toggle(recipe.id)}
              onSave={(change) => save(recipe.id, change)}
              onOpenRecipe={onOpenRecipe}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RecipeRow({
  recipe,
  open,
  busy,
  onChoose,
  onToggle,
  onSave,
  onOpenRecipe,
}: {
  recipe: ImportRecipe;
  open: boolean;
  busy: boolean;
  onChoose: (key: string, productId: string) => void;
  onToggle: () => void;
  onSave: (change: ImportRecipeEdit) => void;
  onOpenRecipe: (recipeId: string) => void;
}) {
  const { t } = useTranslation("recipes");
  const ids = useId();
  const editable = recipe.state === "ready" || recipe.state === "needs_work";

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Badge variant={STATE_BADGE[recipe.state]}>
          {t(`importDraft.recipes.state.${recipe.state}`)}
        </Badge>
        <span className="min-w-0 flex-1 basis-48 font-medium">
          {recipe.title}
        </span>
        <span className="text-sm tabular-nums">
          {t("importDraft.recipes.kcal")}:{" "}
          {recipe.kcal == null
            ? t("importDraft.recipes.notCounted")
            : formatKcal(recipe.kcal)}
        </span>
        <span className="text-sm tabular-nums">
          {t("importDraft.recipes.ratio")}:{" "}
          {recipe.ratio == null
            ? t("importDraft.recipes.notCounted")
            : formatRatio(recipe.ratio)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {recipe.state === "imported" && recipe.recipe_id ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenRecipe(recipe.recipe_id ?? "")}
            >
              {t("importDraft.recipes.open")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={open}
                onClick={onToggle}
              >
                {open
                  ? t("importDraft.recipes.hide")
                  : t("importDraft.recipes.show")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onSave({ skipped: recipe.state !== "skipped" })}
              >
                {recipe.state === "skipped"
                  ? t("importDraft.recipes.unskip")
                  : t("importDraft.recipes.skip")}
              </Button>
            </>
          )}
        </div>
      </div>

      {recipe.problems.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-warning-strong">
          {recipe.problems.map((problem) => (
            <li key={problem}>{t(`importDraft.recipes.problem.${problem}`)}</li>
          ))}
        </ul>
      )}

      {/* Раздел выбирается, не открывая состав: без него рецепт не принять,
          а угадать его по названию получается не всегда. */}
      {editable && recipe.category === null && !open && (
        <div className="max-w-xs">
          <CategorySelect
            id={`${ids}-category-quick`}
            recipe={recipe}
            onSave={onSave}
          />
        </div>
      )}

      {open && editable && (
        <div className="flex flex-col gap-field">
          <div className="grid gap-field @sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem]">
            <label
              className="flex flex-col gap-1 text-sm"
              htmlFor={`${ids}-title`}
            >
              {t("importDraft.recipes.name")}
              <Input
                id={`${ids}-title`}
                key={recipe.title}
                defaultValue={recipe.title}
                maxLength={255}
                onBlur={(event) => {
                  const title = event.target.value.trim();
                  if (title !== recipe.title) onSave({ title });
                }}
              />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor={`${ids}-category`}>
                {t("importDraft.recipes.category")}
              </label>
              <CategorySelect
                id={`${ids}-category`}
                recipe={recipe}
                onSave={onSave}
              />
            </div>
            <label
              className="flex flex-col gap-1 text-sm"
              htmlFor={`${ids}-servings`}
            >
              {t("importDraft.recipes.servings")}
              <Input
                id={`${ids}-servings`}
                key={recipe.servings}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                defaultValue={recipe.servings}
                onBlur={(event) => {
                  const servings = Number(event.target.value);
                  if (
                    Number.isInteger(servings) &&
                    servings >= 1 &&
                    servings <= 100 &&
                    servings !== recipe.servings
                  ) {
                    onSave({ servings });
                  }
                }}
              />
            </label>
          </div>

          <LinesTable
            recipe={recipe}
            busy={busy}
            onChoose={onChoose}
            onSave={onSave}
          />
        </div>
      )}
    </>
  );
}

function CategorySelect({
  id,
  recipe,
  onSave,
}: {
  id: string;
  recipe: ImportRecipe;
  onSave: (change: ImportRecipeEdit) => void;
}) {
  const { t } = useTranslation("recipes");

  return (
    <KitSelect
      id={id}
      aria-label={t("importDraft.recipes.category")}
      value={recipe.category ?? ""}
      onChange={(event) => {
        const category = RECIPE_CATEGORIES.find(
          (value) => value === event.target.value,
        );
        if (category !== undefined) onSave({ category });
      }}
    >
      <option value="" disabled>
        {t("importDraft.recipes.categoryEmpty")}
      </option>
      {RECIPE_CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {t(`categories.${category}`)}
        </option>
      ))}
    </KitSelect>
  );
}

/**
 * Состав рецепта: строка файла рядом с тем, что из неё прочитано.
 *
 * Исходная строка стоит первой колонкой намеренно. Проверить разбор можно
 * только сравнением с оригиналом, и «Сливочное масло — 8,5 г» рядом с массой
 * «85» видно сразу.
 */
function LinesTable({
  recipe,
  busy,
  onChoose,
  onSave,
}: {
  recipe: ImportRecipe;
  busy: boolean;
  onChoose: (key: string, productId: string) => void;
  onSave: (change: ImportRecipeEdit) => void;
}) {
  const { t } = useTranslation("recipes");
  const unconfirmed = recipe.lines.filter(
    (line) => line.state === "unconfirmed",
  );

  return (
    <div className="flex flex-col gap-2 overflow-x-auto">
      {/* Массы, которые не удалось сверить со строкой файла (таблица без
          единиц, две массы в строке), подтверждаются разом — но только здесь,
          под открытым составом, где они перед глазами. */}
      {unconfirmed.length > 1 && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              onSave({
                lines: unconfirmed.map((line) => ({
                  index: line.index,
                  confirmed: true,
                })),
              })
            }
          >
            {t("importDraft.recipes.lines.confirmAll", {
              count: unconfirmed.length,
            })}
          </Button>
        </div>
      )}
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">
          {t("importDraft.recipes.lines.caption", { title: recipe.title })}
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              {t("importDraft.recipes.lines.source")}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {t("importDraft.recipes.lines.product")}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {t("importDraft.recipes.lines.grams")}
            </th>
            <th scope="col" className="py-2 font-medium">
              {t("importDraft.recipes.lines.state")}
            </th>
          </tr>
        </thead>
        <tbody>
          {recipe.lines.map((line) => (
            <LineRow
              key={line.index}
              line={line}
              busy={busy}
              onChoose={(productId) => onChoose(line.key, productId)}
              onSave={(change) =>
                onSave({ lines: [{ index: line.index, ...change }] })
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type LineChange = Omit<NonNullable<ImportRecipeEdit["lines"]>[number], "index">;

function LineRow({
  line,
  busy,
  onChoose,
  onSave,
}: {
  line: ImportLine;
  busy: boolean;
  onChoose: (productId: string) => void;
  onSave: (change: LineChange) => void;
}) {
  const { t } = useTranslation("recipes");
  const [choosing, setChoosing] = useState(false);
  const waiting =
    line.state === "no_product" ||
    line.state === "no_grams" ||
    line.state === "unconfirmed";

  return (
    <tr className="border-b border-border align-top last:border-b-0">
      <td className="py-2 pr-3">
        {line.source === "" ? (
          <>
            {line.name}{" "}
            <span className="text-muted-foreground">
              ({t("importDraft.recipes.lines.noSource")})
            </span>
          </>
        ) : (
          line.source
        )}
      </td>
      <td className="py-2 pr-3">
        {line.state !== "no_product" ? (
          (line.product_name ?? "—")
        ) : choosing ? (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">
              {t("importDraft.recipes.lines.chooseFor", { name: line.name })}
            </span>
            <ImportProductSearch
              onPick={(productId) => {
                setChoosing(false);
                onChoose(productId);
              }}
              onCancel={() => setChoosing(false)}
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setChoosing(true)}
          >
            {t("importDraft.recipes.lines.choose")}
          </Button>
        )}
      </td>
      <td className="py-2 pr-3">
        {line.state === "left_out" ? (
          "—"
        ) : (
          <Input
            // Сервер мог округлить или заменить массу: поле показывает его
            // значение, а не оставшийся набор.
            key={line.grams ?? "empty"}
            className="w-24"
            inputMode="decimal"
            aria-label={t("importDraft.recipes.lines.gramsFor", {
              name: line.name,
            })}
            defaultValue={line.grams == null ? "" : formatMass(line.grams)}
            onBlur={(event) => {
              // «1 500» с пробелом разрядов — то же число, что «1500».
              const grams = Number(
                event.target.value.replace(/\s/g, "").replace(",", "."),
              );
              if (
                Number.isFinite(grams) &&
                grams > 0 &&
                grams <= 5000 &&
                grams !== line.grams
              ) {
                onSave({ grams });
              }
            }}
          />
        )}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={waiting ? "text-warning-strong" : undefined}>
            {t(`importDraft.recipes.lines.${line.state}`)}
          </span>
          {line.state === "unconfirmed" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onSave({ confirmed: true })}
            >
              {t("importDraft.recipes.lines.confirm")}
            </Button>
          )}
          {line.state === "left_out" ? (
            // Вернуть можно только то, что убрали в этой строке. Строка, не
            // взвешиваемая по решению о названии, возвращается там же, где
            // решали, — в списке продуктов.
            line.left_out && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onSave({ left_out: false })}
              >
                {t("importDraft.recipes.lines.restore")}
              </Button>
            )
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onSave({ left_out: true })}
            >
              {t("importDraft.recipes.lines.leaveOut")}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
