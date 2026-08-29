import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api, errorCodeOf } from "../../lib/api";

export type IntakeOption = components["schemas"]["IntakeOptionRead"];
export type AedDrug = components["schemas"]["AedDrugRead"];
export type PatientIntake = components["schemas"]["PatientIntakeRead"];
export type PatientIntakeBody = components["schemas"]["PatientIntakeWrite"];
export type IntakeScale = IntakeOption["scale"];

/**
 * Порядок шкал на экране анкеты.
 *
 * Список объявлен здесь, а не собирается из ответа сервера: справочник может
 * пополниться шкалой, для которой на экране ещё нет поля, и тогда молча
 * появился бы вопрос, который некуда записать.
 */
export const INTAKE_SCALES = [
  "onset_age",
  "seizure_frequency",
  "seizure_duration",
  "aed_switch_count",
  "meals_per_day",
] as const satisfies readonly IntakeScale[];

/** Варианты ответов всех шкал одним запросом: их меньше двадцати. */
export function useIntakeOptions() {
  return useQuery({
    queryKey: ["dictionaries", "intake-options"],
    // Справочник меняет медицинская команда через админку — за время сессии
    // родителя он не меняется, и перезапрашивать его на каждом шаге незачем.
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<IntakeOption[]> => {
      const { data, error } = await api.GET(
        "/api/v1/dictionaries/intake-options",
        // Вместе с выведенными из употребления: заполненная раньше анкета
        // ссылается на прежний вариант, и без него поле показало бы пустоту
        // вместо ответа семьи. Скрывает их форма — см. `visibleOptions`.
        { params: { query: { include_retired: true } } },
      );
      if (error || !data)
        throw error ?? new Error("Empty intake options response");
      return data.items;
    },
  });
}

export function useAedDrugs() {
  return useQuery({
    queryKey: ["dictionaries", "aed-drugs"],
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<AedDrug[]> => {
      const { data, error } = await api.GET("/api/v1/dictionaries/aed-drugs", {
        params: { query: { limit: 100, offset: 0, include_retired: true } },
      });
      if (error || !data) throw error ?? new Error("Empty aed drugs response");
      return data.items;
    },
  });
}

/**
 * Анкета пациента. Незаполненная — это `null`, а не ошибка: сервер отвечает
 * 404, пока анкету ни разу не сохраняли, и экран показывает пустую форму, а не
 * сообщение о сбое.
 */
export function usePatientIntake(patientId: string) {
  return useQuery({
    queryKey: ["patient", patientId, "intake"],
    queryFn: async (): Promise<PatientIntake | null> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/intake",
        {
          params: { path: { patient_id: patientId } },
        },
      );
      if (error) {
        if (errorCodeOf(error) === "not_found") return null;
        throw error;
      }
      return data ?? null;
    },
  });
}

export function useSaveIntakeMutation(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: PatientIntakeBody): Promise<PatientIntake> => {
      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/intake",
        {
          params: { path: { patient_id: patientId } },
          body,
        },
      );
      if (error || !data)
        throw error ?? new Error("Empty save intake response");
      return data;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["patient", patientId, "intake"], saved);
    },
  });
}

/**
 * Варианты одной шкалы в порядке справочника.
 *
 * Выведенный из употребления вариант показывается, только если он уже выбран:
 * предлагать его новому ответу нельзя, а скрыть у старого — значит подменить
 * ответ семьи пустотой.
 */
export function optionsOfScale(
  options: readonly IntakeOption[],
  scale: IntakeScale,
  selectedId = "",
): IntakeOption[] {
  return options.filter(
    (option) =>
      option.scale === scale && (!option.retired || option.id === selectedId),
  );
}

/** То же правило для препаратов: выведенный виден, только если уже отмечен. */
export function visibleDrugs(
  drugs: readonly AedDrug[],
  selected: readonly string[],
): AedDrug[] {
  return drugs.filter((drug) => !drug.retired || selected.includes(drug.id));
}
