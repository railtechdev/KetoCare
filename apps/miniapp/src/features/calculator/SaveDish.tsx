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
 */
export function SaveDish({
  patientId,
  rows,
  blockedBy,
}: {
  patientId: string;
  rows: DishRow[];
  /** Почему сохранить нельзя сейчас; `null` — состав проверен и готов. */
  blockedBy: string | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const save = useSaveDish(patientId);
  // `null` — человек название не трогал, и оно следует за составом.
  const [typed, setTyped] = useState<string | null>(null);
  const title = typed ?? suggestedTitle(rows);
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
        <AddToPlan patientId={patientId} dishId={saved.dish.id} />
      </Section>
    );
  }

  const reason =
    blockedBy ??
    (title.trim() === "" ? t("calculator.save.blocked.noTitle") : null);

  return (
    <Section
      title={t("calculator.save.title")}
      description={t("calculator.save.description")}
      density="compact"
    >
      <form
        className="flex flex-col gap-field"
        onSubmit={(event) => {
          event.preventDefault();
          // Выключенная кнопка — не единственная защита: отправка формы с
          // клавиатуры обходит её.
          if (reason !== null || save.isPending) return;
          save.mutate(
            { title: title.trim(), rows, idempotencyKey: attemptKey },
            {
              onSuccess: (dish) => {
                setSaved({ dish, composition });
                setTyped(null);
                void queryClient.invalidateQueries({
                  queryKey: ["patient", patientId, "custom-dishes"],
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
            }}
          />
        </div>

        {save.isError && (
          <WarningBanner level="danger" title={t("calculator.save.failed")}>
            {errorMessageOf(save.error) ?? t("calculator.errorHint")}
          </WarningBanner>
        )}

        <Button
          type="submit"
          className="min-h-touch w-full"
          disabled={reason !== null || save.isPending}
          aria-busy={save.isPending || undefined}
          aria-describedby={reason !== null ? reasonId : undefined}
        >
          {save.isPending
            ? t("calculator.save.saving")
            : t("calculator.save.submit")}
        </Button>
        <ActionReason id={reasonId}>{reason}</ActionReason>
      </form>
    </Section>
  );
}
