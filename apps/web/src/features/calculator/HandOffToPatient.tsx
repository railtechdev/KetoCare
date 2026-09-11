import { FormFooter, Section, toast } from "@ketocare/ui";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import type { Patient } from "../doctor/types";
import { PatientPicker } from "../patients/PatientPicker";
import { incomingDish } from "./incomingDish";
import type { DishRow } from "./types";
import { useSaveDishMutation } from "./useCalcMutations";

/**
 * Передача набранного состава конкретному ребёнку.
 *
 * Специалист собирает раскладку до того, как решил, кому она нужна: «выйдет ли
 * 4:1 на этих продуктах» — вопрос о продуктах, а не о ребёнке. Требовать выбрать
 * пациента ДО расчёта значило показывать когорту вместо калькулятора, что и
 * происходило: на пятидесяти пациентах экран начинался с пятидесяти кнопок.
 *
 * Передача — это сохранение в блюда ребёнка, а не отдельная сущность:
 * «назначить состав» нельзя, назначение — это соотношение, калорийность и
 * лимиты, и живёт оно в своём разделе. Здесь появляется блюдо, которое семья
 * увидит при сборке меню.
 *
 * Сразу после сохранения открывается калькулятор в карте ребёнка с тем же
 * составом (`?item=dish:<id>`): там у него есть кетосоотношение из назначения и
 * проверка на исключённые продукты, то есть то единственное, чего не могло быть
 * в общем калькуляторе. Проверить блюдо против цели ребёнка — второй шаг той же
 * работы, и заставлять искать его руками незачем.
 */
export function HandOffToPatient({
  rows,
  blockedBy = null,
}: {
  rows: DishRow[];
  /** Почему набранный состав передать нельзя — например, масса тяжелее предела. */
  blockedBy?: string | null;
}) {
  const { t } = useTranslation("calculator");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const save = useSaveDishMutation(patient?.id ?? null);

  const ready = title.trim() !== "" && patient !== null && blockedBy === null;

  return (
    <Section
      title={t("handoff.title")}
      description={t("handoff.description")}
      level={2}
    >
      <form
        className="flex flex-col gap-block"
        onSubmit={(event) => {
          event.preventDefault();
          if (patient === null) return;

          save.mutate(
            { title: title.trim(), rows },
            {
              onSuccess: (dish) => {
                toast.success(t("handoff.saved", { name: patient.full_name }), {
                  description: t("handoff.savedBody"),
                });
                void queryClient.invalidateQueries({
                  queryKey: ["patient", patient.id, "custom-dishes"],
                });
                void navigate({
                  to: "/app/patients/$patientId/$view",
                  params: { patientId: patient.id, view: "calculator" },
                  search: { item: incomingDish(dish.id) },
                });
              },
            },
          );
        }}
      >
        <Field
          id="handoff-title"
          width="wide"
          label={t("handoff.name")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        {/* Подписи над элементом нет намеренно: `<label for>` перебил бы имя
            выбранного ребёнка в доступном имени кнопки, и скринридер называл
            бы её «Пациент» независимо от того, кто выбран. Поэтому подпись
            несёт сама кнопка: до выбора — «Выбрать пациента», после — имя. */}
        <PatientPicker
          selectedId={patient?.id}
          label={t("handoff.patientLabel")}
          trigger={patient?.full_name ?? t("handoff.patientLabel")}
          onSelect={setPatient}
        />

        {save.isError && (
          <FormError>
            {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        {/* Подвал формы — общий: подтверждение первым, подпись меняется на
            время отправки. Кнопка выключена, пока не названы блюдо и ребёнок:
            отправлять нечего, и отказ после нажатия был бы лишним шагом. И
            выключена не молча — подвал называет, чего не хватает (правило
            П44 канона). */}
        <FormFooter
          submitLabel={t("handoff.submit")}
          pendingLabel={t("handoff.pending")}
          pending={save.isPending}
          disabled={!ready}
          // Состав первым: он выше формы, и без него название и пациент
          // ничего не дают.
          reason={
            blockedBy ??
            (title.trim() === ""
              ? t("handoff.blocked.noTitle")
              : t("handoff.blocked.noPatient"))
          }
        />
      </form>
    </Section>
  );
}
