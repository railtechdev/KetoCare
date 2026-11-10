import {
  Button,
  FormFooter,
  Section,
  toast,
  useAttemptKey,
} from "@ketocare/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SectionLink } from "../../components/SectionLink";
import { PatientViewLink } from "../doctor/PatientViewLink";
import {
  customDishesKey,
  useUpdateCustomDish,
  type CustomDish,
} from "../dishes/useCustomDishes";
import { errorMessageOf } from "../../lib/api";
import { dishSignature, type DishRow } from "./types";
import { useSaveDishMutation } from "./useCalcMutations";

interface Props {
  /**
   * Ребёнок известен всегда: экран калькулятора обёрнут в `PatientGate`, а он
   * сам показывает и «выберите ребёнка», и «добавьте ребёнка». Ветка «ребёнка
   * нет» здесь была недостижимой — и второй, расходящейся со временем
   * формулировкой того же правила.
   */
  patientId: string;
  rows: DishRow[];
  /**
   * Почему состав сохранить нельзя, хотя он набран, — например, масса тяжелее
   * предела расчёта. `null` — препятствий в составе нет.
   */
  blockedBy?: string | null;
  /**
   * Чего форма ждёт само собой — ответа проверки. Называется после того, что
   * человеку нужно сделать самому: иначе строка прыгала бы между «блюдо не
   * названо» и «ждём расчёта» на каждой правке состава.
   */
  waitingFor?: string | null;
  /** The form stands in a patient's card, where the dish belongs to the child. */
  inCard?: boolean;
  /** Saved dish open in the calculator; `null` when composing a new one. */
  editing?: { id: string; title: string } | null;
  /** A copy was saved while editing: the calculator now shows the copy. */
  onSavedAsNew?: (dishId: string) => void;
}

/** «Сохранить как моё блюдо» (раздел 8.3 ТЗ). */
export function SaveDishForm({
  patientId,
  rows,
  blockedBy = null,
  waitingFor = null,
  inCard = false,
  editing = null,
  onSavedAsNew,
}: Props) {
  const { t } = useTranslation("calculator");
  const queryClient = useQueryClient();
  const save = useSaveDishMutation(patientId);
  const [title, setTitle] = useState("");
  const update = useUpdateCustomDish(patientId);
  const [saved, setSaved] = useState(false);
  // The title follows the opened dish, and only when another dish is opened.
  const [editedId, setEditedId] = useState<string | null>(null);
  if ((editing?.id ?? null) !== editedId) {
    setEditedId(editing?.id ?? null);
    if (editing !== null) setTitle(editing.title);
  }
  // Пока название и состав те же, попытка та же: повтор после потерянного
  // ответа не создаст второго блюда (ADR-0035).
  const attemptKey = useAttemptKey(dishSignature(patientId, title, rows));

  const cannotSave =
    title.trim() === "" ||
    rows.length === 0 ||
    blockedBy !== null ||
    waitingFor !== null;
  const pending = save.isPending || update.isPending;
  const failure = save.error ?? update.error;

  function saveAsNew(): void {
    save.mutate(
      { title: title.trim(), rows, idempotencyKey: attemptKey },
      {
        onSuccess: (created) => {
          // Успех — тост, а не зелёная строка навсегда в потоке страницы (П16
          // канона): форма остаётся на месте и готова принять следующее блюдо.
          toast.success(t("save.saved"));
          if (editing !== null) {
            // In the cache before the address changes: the calculator finds
            // the opened dish in this list and would report it as missing.
            queryClient.setQueryData<CustomDish[]>(
              customDishesKey(patientId),
              (current) => [...(current ?? []), created],
            );
            onSavedAsNew?.(created.id);
          } else {
            setTitle("");
          }
          setSaved(true);
          void queryClient.invalidateQueries({
            queryKey: ["patient", patientId, "custom-dishes"],
          });
        },
      },
    );
  }

  function saveChanges(dishId: string): void {
    update.mutate(
      {
        dishId,
        title: title.trim(),
        ingredients: rows.map((row) => ({
          product_id: row.product.id,
          grams: row.grams,
        })),
      },
      {
        onSuccess: () => {
          toast.success(t("save.savedChanges"));
          setSaved(true);
        },
      },
    );
  }

  const heading =
    editing !== null
      ? t("save.editAction")
      : inCard
        ? t("save.actionChild")
        : t("save.action");
  const description =
    editing !== null
      ? t("save.editDescription")
      : inCard
        ? t("save.descriptionChild")
        : t("save.description");

  return (
    <Section title={heading} description={description}>
      <form
        className="flex flex-col gap-section"
        onSubmit={(event) => {
          event.preventDefault();
          // Выключенная кнопка — не единственная защита: форма — последняя
          // проверка перед сохранением (сервер исключённое ребёнку не сверяет),
          // и отправка в обход кнопки не должна её миновать.
          if (cannotSave) return;
          if (editing !== null) saveChanges(editing.id);
          else saveAsNew();
        }}
      >
        <Field
          id="dish-title"
          label={t("save.title")}
          required
          width="wide"
          value={title}
          placeholder={t("save.placeholder")}
          onChange={(event) => {
            setTitle(event.target.value);
            if (saved) setSaved(false);
          }}
        />

        {failure !== null && (
          <FormError>
            {errorMessageOf(failure) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={
            editing !== null ? t("save.submitChanges") : t("save.submit")
          }
          pendingLabel={t("save.saving")}
          pending={pending}
          disabled={cannotSave}
          extra={
            editing !== null ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-touch"
                disabled={pending || cannotSave}
                onClick={saveAsNew}
              >
                {t("save.saveAsNew")}
              </Button>
            ) : undefined
          }
          // Сначала то, что устраняет человек, — в порядке, в каком устраняют;
          // ожидание проверки последним: оно проходит само.
          reason={
            rows.length === 0
              ? t("blocked.noRows")
              : (blockedBy ??
                (title.trim() === ""
                  ? t("save.blocked.noTitle")
                  : (waitingFor ?? undefined)))
          }
        />

        {saved && (
          <div className="flex flex-wrap items-center gap-field pt-1">
            {inCard ? (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="min-h-touch"
              >
                <PatientViewLink patientId={patientId} view="menu">
                  {t("save.toMenu")}
                </PatientViewLink>
              </Button>
            ) : (
              <>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="min-h-touch"
                >
                  <SectionLink section="menu">{t("save.toMenu")}</SectionLink>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="min-h-touch"
                >
                  <SectionLink section="diary" diaryKind="meals" item="new">
                    {t("save.toDiary")}
                  </SectionLink>
                </Button>
              </>
            )}
          </div>
        )}
      </form>
    </Section>
  );
}
