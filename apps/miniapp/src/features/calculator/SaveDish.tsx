import {
  ActionReason,
  Button,
  Input,
  Section,
  WarningBanner,
  useAttemptKey,
} from "@ketocare/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { AddToPlan } from "../menu/AddToPlan";
import {
  type DishRow,
  type SavedDish,
  dishSignature,
  useSaveDish,
  useUpdateDish,
} from "./useCalculator";

/** Сколько названий продуктов подставлять в название блюда. */
const TITLE_PRODUCTS = 3;

/**
 * Название по умолчанию — из продуктов состава.
 *
 * Пустое поле на телефоне — лишний набор у плиты, а «Блюдо 1» в списке блюд
 * ребёнка через неделю ничего не скажет. Названия продуктов — то, по чему семья
 * и узнает блюдо; поправить их — дело одного касания.
 */
export function suggestedTitle(rows: DishRow[]): string {
  const names = rows.slice(0, TITLE_PRODUCTS).map((row) => row.product.name);
  return rows.length > TITLE_PRODUCTS
    ? `${names.join(", ")}…`
    : names.join(", ");
}

/**
 * «Сохранить как блюдо» и следом «Добавить в план» (ADR-0028, дополнение
 * 05.10.2026).
 *
 * Без этого калькулятор Mini App был тупиком: граммовку считал, а унести её
 * было некуда — у семьи из Telegram кабинета нет, и посчитанное оставалось
 * только переписать на бумагу. Сохранённое блюдо сразу ставится в день тем же
 * путём записи, что и на вкладке «Меню».
 *
 * Сохраняется только проверенный состав: показатели на экране обязаны быть
 * посчитаны по тому, что уходит на сервер (`blockedBy` от экрана). Сохранённое
 * действует, пока состав тот же: правка граммовки после сохранения — уже другое
 * блюдо, и форма возвращается.
 *
 * `editing` — в расчёте открыто блюдо ребёнка (Б1). Тогда первое действие —
 * «Сохранить изменения» в это блюдо (название и шаги остаются его), а новое
 * блюдо — вторым, явно названным. Прежде исправление граммовки заводило
 * второе блюдо с названием из продуктов и без шагов, а ошибочное оставалось в
 * выборе блюда под знакомым именем.
 */
export function SaveDish({
  patientId,
  rows,
  blockedBy,
  editing = null,
  onNew,
}: {
  patientId: string;
  rows: DishRow[];
  /** Блюдо ребёнка, чей состав сейчас в расчёте. */
  editing?: { id: string; title: string } | null;
  /** Почему сохранить нельзя сейчас; `null` — состав проверен и готов. */
  blockedBy: string | null;
  /** Начать новое блюдо с пустого состава — следующий шаг после «Добавлено». */
  onNew?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const save = useSaveDish(patientId);
  const update = useUpdateDish(patientId);
  // `null` — человек название не трогал: у открытого блюда это его имя, у
  // нового — имена продуктов состава.
  const [typed, setTyped] = useState<string | null>(null);
  const title = typed ?? editing?.title ?? suggestedTitle(rows);
  const signature = dishSignature(patientId, title, rows);
  const attemptKey = useAttemptKey(signature);
  const composition = dishSignature(patientId, "", rows);
  const [saved, setSaved] = useState<{
    dish: SavedDish;
    composition: string;
  } | null>(null);
  const titleId = useId();
  const reasonId = useId();

  if (saved !== null && saved.composition === composition) {
    return (
      <Section title={t("calculator.plan.title")} density="compact">
        <p role="status" className="m-0 text-sm text-success">
          {t("calculator.save.saved", { title: saved.dish.title })}
        </p>
        <AddToPlan
          patientId={patientId}
          dish={{ kind: "custom", id: saved.dish.id }}
          afterAdded={
            onNew !== undefined && (
              <Button
                type="button"
                variant="outline"
                className="min-h-touch w-full"
                onClick={onNew}
              >
                {t("calculator.save.another")}
              </Button>
            )
          }
        />
      </Section>
    );
  }

  const reason =
    blockedBy ??
    (title.trim() === "" ? t("calculator.save.blocked.noTitle") : null);
  const pending = save.isPending || update.isPending;
  const failed = save.isError
    ? save.error
    : update.isError
      ? update.error
      : null;

  const onSaved = (dish: SavedDish) => {
    setSaved({ dish, composition });
    setTyped(null);
    void queryClient.invalidateQueries({
      queryKey: ["patient", patientId, "custom-dishes"],
    });
  };

  const saveAsNew = () => {
    if (reason !== null || pending) return;
    update.reset();
    save.mutate(
      { title: title.trim(), rows, idempotencyKey: attemptKey },
      { onSuccess: onSaved },
    );
  };

  return (
    <Section
      title={
        editing === null
          ? t("calculator.save.title")
          : t("calculator.save.editTitle")
      }
      description={
        editing === null
          ? t("calculator.save.description")
          : t("calculator.save.editDescription", { title: editing.title })
      }
      density="compact"
    >
      <form
        className="flex flex-col gap-field"
        onSubmit={(event) => {
          event.preventDefault();
          // Выключенная кнопка — не единственная защита: отправка формы с
          // клавиатуры обходит её.
          if (reason !== null || pending) return;
          if (editing === null) {
            saveAsNew();
            return;
          }
          save.reset();
          update.mutate(
            { dishId: editing.id, title: title.trim(), rows },
            {
              onSuccess: (dish) => {
                onSaved(dish);
                // Пометка «блюдо изменилось» у дней, где оно уже стоит.
                void queryClient.invalidateQueries({
                  queryKey: ["patient", patientId, "menu"],
                });
              },
            },
          );
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={titleId} className="text-sm">
            {t("calculator.save.name")}
          </label>
          <Input
            id={titleId}
            value={title}
            maxLength={255}
            onChange={(event) => {
              setTyped(event.target.value);
              save.reset();
              update.reset();
            }}
          />
        </div>

        {failed !== null && (
          <WarningBanner level="danger" title={t("calculator.save.failed")}>
            {errorMessageOf(failed) ?? t("calculator.errorHint")}
          </WarningBanner>
        )}

        <Button
          type="submit"
          className="min-h-touch w-full"
          disabled={reason !== null || pending}
          aria-busy={(editing === null ? save : update).isPending || undefined}
          aria-describedby={reason !== null ? reasonId : undefined}
        >
          {(editing === null ? save : update).isPending
            ? t("calculator.save.saving")
            : editing === null
              ? t("calculator.save.submit")
              : t("calculator.save.update")}
        </Button>
        {editing !== null && (
          <Button
            type="button"
            variant="outline"
            className="min-h-touch w-full"
            disabled={reason !== null || pending}
            aria-busy={save.isPending || undefined}
            aria-describedby={reason !== null ? reasonId : undefined}
            onClick={saveAsNew}
          >
            {save.isPending
              ? t("calculator.save.saving")
              : t("calculator.save.asNew")}
          </Button>
        )}
        <ActionReason id={reasonId}>{reason}</ActionReason>
      </form>
    </Section>
  );
}
