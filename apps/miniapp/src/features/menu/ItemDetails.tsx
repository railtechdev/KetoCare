import { Button, cn, formatMass } from "@ketocare/ui";
import { ChefHat, ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { WeighNote, WeighRow } from "../recipes/ProductComposition";
import type { MenuItem } from "./useMenu";

/**
 * «Что взвесить» и «Как готовить» под блюдом — одни на меню дня и «Сегодня».
 *
 * Граммы приходят с сервера уже на эту позицию (ADR-0015, ADR-0016): доумножать
 * их здесь нечем. Раскрывается кнопкой со стрелкой, а не системным
 * `<details>`: тот на телефоне рисуется по-своему в каждом браузере и не держит
 * высоту касания. Кнопка обведена, как остальные кнопки: серая надпись без
 * рамки не читалась как то, на что нажимают (аудит Mini App 21.11.2026, М1).
 *
 * `weighOpen` — список граммов раскрыт сразу. Так на «Сегодня» у ближайшего
 * приёма: родитель у плиты видит граммы, не открывая меню.
 */
export function ItemDetails({
  item,
  onOpenRecipe,
  weighOpen = false,
}: {
  item: MenuItem;
  /** Открыть карточку рецепта. Нет — кнопки «Как готовить» у рецепта нет. */
  onOpenRecipe?: (recipeId: string) => void;
  weighOpen?: boolean;
}) {
  const { t } = useTranslation();
  const lines = item.ingredients ?? [];
  const recipeId = item.recipe_id;
  // Блюдо ребёнка хранит шаги своего рецепта (ADR-0088): у него нет экрана
  // рецепта, поэтому шаги раскрываются здесь же.
  const steps = recipeId === null ? (item.instructions ?? "").trim() : "";
  const showRecipe = recipeId !== null && onOpenRecipe !== undefined;
  if (lines.length === 0 && !showRecipe && steps === "") return null;

  return (
    <div className="flex flex-col gap-1 pl-8 text-sm">
      {lines.length > 0 && (
        <Disclosure label={t("menu.composition")} initiallyOpen={weighOpen}>
          <WeighList lines={lines} />
        </Disclosure>
      )}
      {/* Рецепт ↔ меню в обе стороны: из меню — к тому, как готовить. */}
      {showRecipe && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-touch self-start"
          onClick={() => onOpenRecipe(recipeId)}
        >
          <ChefHat aria-hidden="true" className="size-4" />
          {t("menu.howToCook")}
        </Button>
      )}
      {steps !== "" && (
        <Disclosure label={t("menu.howToCook")}>
          <p className="m-0 whitespace-pre-line break-words">{steps}</p>
        </Disclosure>
      )}
    </div>
  );
}

/** Кнопка со стрелкой и то, что она раскрывает. */
export function Disclosure({
  label,
  initiallyOpen = false,
  children,
}: {
  label: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const panelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-touch self-start"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </Button>
      <div id={panelId} hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}

type WeighLine = NonNullable<MenuItem["ingredients"]>[number];

/** Продукты и граммы позиции; приправа помечена — в итогах дня её нет. */
function WeighList({ lines }: { lines: readonly WeighLine[] }) {
  const { t } = useTranslation();
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {lines.map((line) => (
        <WeighRow
          key={line.product_id}
          name={line.name_ru}
          notes={
            // Приправу взвешивают, но в итогах дня её нет (ADR-0054).
            line.counts_in_calculation === false && (
              <WeighNote>{t("menu.uncounted")}</WeighNote>
            )
          }
          grams={t("menu.grams", { value: formatMass(line.grams) })}
        />
      ))}
    </ul>
  );
}
