import {
  Button,
  FormFooter,
  Section,
  toast,
  useAttemptKey,
} from "@ketocare/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SectionLink } from "../../components/SectionLink";
import { PatientViewLink } from "../doctor/PatientViewLink";
import { MenuSlotFields } from "../menu/AddToMenu";
import { useAddToMenu, type MenuSlot } from "../menu/useAddToMenu";
import { formatDayLabel, todayIso } from "../menu/dates";
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
  /** The dish was written: the composition on screen is no longer a draft. */
  onSaved?: () => void;
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
  onSaved,
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

  // Куда в меню ставит «Сохранить и добавить в меню». Поля стоят в форме
  // всегда: спрашивать день и приём отдельным шагом после сохранения — это
  // те же два поля, но ещё одно нажатие и ещё один блок под формой.
  const [slot, setSlot] = useState<MenuSlot>(() => ({
    date: todayIso(),
    mealIndex: 1,
  }));
  const menu = useAddToMenu(patientId);
  // Сохранение и постановка в меню — одна попытка: второе нажатие, пока она
  // идёт, не сохраняет и не ставит блюдо второй раз.
  const busy = useRef(false);

  const cannotSave =
    title.trim() === "" ||
    rows.length === 0 ||
    blockedBy !== null ||
    waitingFor !== null;
  const pending = save.isPending || update.isPending || menu.pending;
  const failure = save.error ?? update.error;

  /** Записать блюдо; `null` — запись не удалась, причину покажет форма. */
  async function persist(quiet: boolean): Promise<string | null> {
    try {
      if (editing !== null) {
        await update.mutateAsync({
          dishId: editing.id,
          title: title.trim(),
          ingredients: rows.map((row) => ({
            product_id: row.product.id,
            grams: row.grams,
          })),
        });
        if (!quiet) toast.success(t("save.savedChanges"));
        setSaved(true);
        onSaved?.();
        return editing.id;
      }
      return await saveAsNew(quiet);
    } catch {
      return null;
    }
  }

  async function saveAsNew(quiet: boolean): Promise<string | null> {
    try {
      const created = await save.mutateAsync({
        title: title.trim(),
        rows,
        idempotencyKey: attemptKey,
      });
      // Успех — тост, а не зелёная строка навсегда в потоке страницы (П16
      // канона): форма остаётся на месте и готова принять следующее блюдо.
      if (!quiet) toast.success(t("save.saved"));
      // In the cache before the address changes: the calculator finds the
      // opened dish in this list and would report it as missing. The saved
      // dish stays open, so a second save edits it instead of duplicating.
      queryClient.setQueryData<CustomDish[]>(
        customDishesKey(patientId),
        (current) => [...(current ?? []), created],
      );
      onSavedAsNew?.(created.id);
      setSaved(true);
      onSaved?.();
      void queryClient.invalidateQueries({
        queryKey: ["patient", patientId, "custom-dishes"],
      });
      return created.id;
    } catch {
      return null;
    }
  }

  async function run(action: "save" | "saveAsNew" | "saveToMenu") {
    if (busy.current || cannotSave) return;
    busy.current = true;
    try {
      if (action === "saveAsNew") {
        await saveAsNew(false);
        return;
      }
      const toMenu = action === "saveToMenu";
      const dishId = await persist(toMenu);
      if (dishId === null || !toMenu) return;
      const dishTitle = title.trim();
      const done = await menu.add(
        { kind: "custom", id: dishId, title: dishTitle },
        slot,
      );
      if (done) {
        toast.success(
          t("save.savedToMenu", {
            day: formatDayLabel(slot.date),
            meal: t("menu:meal.name", { index: slot.mealIndex }),
          }),
        );
      }
    } finally {
      busy.current = false;
    }
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
          void run("save");
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

        <fieldset className="m-0 flex min-w-0 flex-col gap-field border-0 p-0">
          <legend className="mb-field p-0 text-sm font-medium">
            {t("save.menuSlot")}
          </legend>
          <MenuSlotFields
            patientId={patientId}
            slot={slot}
            onChange={(next) => {
              setSlot(next);
              menu.reset();
            }}
          />
        </fieldset>

        {failure !== null && (
          <FormError>
            {errorMessageOf(failure) ?? t("common:errors.unexpected")}
          </FormError>
        )}
        {menu.error !== null && (
          <FormError>
            {errorMessageOf(menu.error) ?? t("common:errors.unexpected")}
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
            <>
              <Button
                type="button"
                variant="outline"
                className="min-h-touch"
                disabled={pending || cannotSave || slot.date === ""}
                onClick={() => void run("saveToMenu")}
              >
                {t("save.submitToMenu")}
              </Button>
              {editing !== null && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-touch"
                  disabled={pending || cannotSave}
                  onClick={() => void run("saveAsNew")}
                >
                  {t("save.saveAsNew")}
                </Button>
              )}
            </>
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

        {/* «Записать как приём пищи» здесь больше нет: запись дневника еды —
            свободный текст, сослаться на блюдо она не умеет, и форма
            открывалась пустой. Что ребёнок съел это блюдо, записывает отметка
            «съедено» в меню — с граммами, которые входят в итоги дня. */}
        {saved && (
          <div className="flex flex-wrap items-center gap-field pt-1">
            <Button asChild variant="outline" size="sm" className="min-h-touch">
              {inCard ? (
                <PatientViewLink patientId={patientId} view="menu">
                  {t("save.toMenu")}
                </PatientViewLink>
              ) : (
                <SectionLink section="menu">{t("save.toMenu")}</SectionLink>
              )}
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}
