import { useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";
import { fetchKind, type DiaryLog } from "../diary/useDiary";

type MedicationRead = components["schemas"]["MedicationRead"];

/** Препарат схемы врача, как его показывает блок «Лекарства сегодня». */
export type ActiveMedication = Pick<
  MedicationRead,
  | "id"
  | "drug_name"
  | "dose"
  | "frequency_code"
  | "frequency"
  | "started_at"
  | "stopped_at"
>;

/**
 * Принимается ли препарат в этот день: начат не позже и не окончен раньше.
 *
 * Отбирает и сервер (`active_on`), но список схемы лежит в кэше и под другими
 * ключами — правило здесь же, чтобы блок не показал отменённый препарат ни при
 * каком источнике. Даты — `YYYY-MM-DD`, они сравниваются строкой.
 */
export function isActiveOn(medication: ActiveMedication, day: string): boolean {
  return (
    medication.started_at <= day &&
    (medication.stopped_at == null || medication.stopped_at >= day)
  );
}

/** Препараты, которые ребёнок принимает в этот день, — по схеме врача. */
export function useActiveMedications(patientId: string, day: string) {
  return useQuery({
    queryKey: ["patient", patientId, "medications", "active", day],
    queryFn: async (): Promise<ActiveMedication[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/medications",
        {
          params: {
            path: { patient_id: patientId },
            query: { active_on: day, limit: 200, offset: 0 },
          },
        },
      );
      if (error || !data)
        throw error ?? new Error("Empty medications response");
      return data.items.filter((item) => isActiveOn(item, day));
    },
  });
}

/**
 * Вся схема препаратов ребёнка — для экрана «Схема препаратов» (Р4 аудита Mini
 * App 21.11.2026). Без `active_on`: в схеме и препараты, которые начнутся
 * позже. Отменённые отбирает правило кита (`scheduledMedications`), общее с
 * листом кабинета.
 */
export function useMedicationScheme(patientId: string) {
  return useQuery({
    queryKey: ["patient", patientId, "medications", "scheme"],
    queryFn: async (): Promise<ActiveMedication[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/medications",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: 200, offset: 0 },
          },
        },
      );
      if (error || !data)
        throw error ?? new Error("Empty medications response");
      return data.items;
    },
  });
}

/** Границы местных суток — моменты с поясом, как у ленты дневника. */
export function dayRange(now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Сегодняшние отметки о приёме — ключ того же вида, что у ленты дневника
 * («пациент → logs → вид → период»): новая отметка и «Отменить» сбрасывают
 * его вместе с лентой.
 */
export function useTodayMedicationLogs(patientId: string) {
  const range = dayRange();
  return useQuery({
    queryKey: [
      "patient",
      patientId,
      "logs",
      "medications",
      range.from,
      range.to,
    ],
    queryFn: async () =>
      (await fetchKind(patientId, "medications", range)).filter(
        (entry): entry is Extract<DiaryLog, { kind: "medications" }> =>
          entry.kind === "medications",
      ),
  });
}
