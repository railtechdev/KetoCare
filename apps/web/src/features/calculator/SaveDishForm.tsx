import { FormFooter, Section, toast } from "@ketocare/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf, isNetworkFailure } from "../../lib/api";
import type { DishRow } from "./types";
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
}

/** «Сохранить как моё блюдо» (раздел 8.3 ТЗ). */
export function SaveDishForm({
  patientId,
  rows,
  blockedBy = null,
  waitingFor = null,
}: Props) {
  const { t } = useTranslation("calculator");
  const queryClient = useQueryClient();
  const save = useSaveDishMutation(patientId);
  const [title, setTitle] = useState("");

  return (
    <Section title={t("save.action")} description={t("save.description")}>
      <form
        className="flex flex-col gap-block"
        onSubmit={(event) => {
          event.preventDefault();
          // Выключенная кнопка — не единственная защита: форма — последняя
          // проверка перед сохранением (сервер исключённое ребёнку не сверяет),
          // и отправка в обход кнопки не должна её миновать.
          if (blockedBy !== null || waitingFor !== null) return;
          save.mutate(
            { title: title.trim(), rows },
            {
              onSuccess: () => {
                // Успех — тост, а не зелёная строка навсегда в потоке
                // страницы (П16 канона): форма остаётся на месте и готова
                // принять следующее блюдо.
                toast.success(t("save.saved"));
                setTitle("");
                void queryClient.invalidateQueries({
                  queryKey: ["patient", patientId, "custom-dishes"],
                });
              },
            },
          );
        }}
      >
        <Field
          id="dish-title"
          label={t("save.title")}
          required
          width="wide"
          value={title}
          placeholder={t("save.placeholder")}
          onChange={(event) => setTitle(event.target.value)}
        />

        {save.isError && (
          <FormError>
            {errorMessageOf(save.error) ??
              (isNetworkFailure(save.error)
                ? t("common:errors.network")
                : t("common:errors.unexpected"))}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("save.submit")}
          pendingLabel={t("save.saving")}
          pending={save.isPending}
          disabled={
            title.trim() === "" ||
            rows.length === 0 ||
            blockedBy !== null ||
            waitingFor !== null
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
      </form>
    </Section>
  );
}
