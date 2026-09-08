import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { Patient } from "../doctor/types";

export function patientKey(patientId: string) {
  return ["patient", patientId, "profile"] as const;
}

/**
 * Один пациент по идентификатору из адреса.
 *
 * Отдельным запросом, а не поиском в списке: список отдаёт первые 200 строк
 * (`DOCTOR_PAGE_LIMIT`), и до этого хука карта пациента, не попавшего в первую
 * страницу, не открывалась вовсе — адрес был верным, ссылка рабочей, а экран
 * возвращал в список. Заметить это можно было только на клинике с большой
 * когортой, то есть у заказчика и не у нас.
 *
 * Заодно карта перестала ждать список: открытая по ссылке, она грузит одного
 * пациента вместо двухсот.
 */
export function usePatient(patientId: string) {
  return useQuery({
    queryKey: patientKey(patientId),
    queryFn: async (): Promise<Patient> => {
      const { data, error } = await api.GET("/api/v1/patients/{patient_id}", {
        params: { path: { patient_id: patientId } },
      });
      if (error || !data) throw error ?? new Error("Empty patient response");
      return data;
    },
  });
}
