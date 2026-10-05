import type { components } from "@ketocare/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { patientOverviewKey } from "../patients/overview";
import { medicalProfileKey } from "./doctorQueries";

type Schemas = components["schemas"];

export type ControlSchedule = Schemas["ControlScheduleRead"];
export type ControlVisit = Schemas["ControlVisitRead"];
export type ControlVisitCreate = Schemas["ControlVisitCreate"];
export type ControlVisitUpdate = Schemas["ControlVisitUpdate"];
export type TherapyEndBody = Schemas["TherapyEndWrite"];
export type TherapyEndReason = Schemas["TherapyEndReason"];
export type Growth = Schemas["GrowthRead"];
export type GrowthIndicator = Schemas["GrowthIndicatorRead"];

/**
 * Причины завершения терапии — тот же закрытый список, что на сервере
 * (`TherapyEndReason`). Список провизорный (вопрос 52 медкоманде), подписи — в
 * словаре `doctor.course.reasons.*`.
 */
export const THERAPY_END_REASONS: readonly TherapyEndReason[] = [
  "course_completed",
  "ineffective",
  "adverse_effects",
  "family_decision",
  "transferred",
  "other",
];

export function controlScheduleKey(patientId: string) {
  return ["patient", patientId, "control-schedule"] as const;
}

export function growthKey(patientId: string) {
  return ["patient", patientId, "growth"] as const;
}

/** График контроля: визиты и перечни анализов клиники (вопросы 17 и 34). */
export function useControlSchedule(patientId: string) {
  return useQuery({
    queryKey: controlScheduleKey(patientId),
    retry: false,
    queryFn: async (): Promise<ControlSchedule> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/control-schedule",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty schedule response");
      return data;
    },
  });
}

/** Рост и вес относительно норм ВОЗ (вопрос 15). */
export function useGrowth(patientId: string) {
  return useQuery({
    queryKey: growthKey(patientId),
    retry: false,
    queryFn: async (): Promise<Growth> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/growth",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty growth response");
      return data;
    },
  });
}

/**
 * Всё, что меняет ход терапии: завершение, график визитов.
 *
 * После любой правки устаревают сводка (ближайший контроль, отметка о
 * завершении), профиль (причина завершения) и список пациентов (ребёнок
 * уходит из рабочего списка или возвращается в него).
 */
export function useTherapyCourseMutations(patientId: string) {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: controlScheduleKey(patientId),
      }),
      queryClient.invalidateQueries({
        queryKey: patientOverviewKey(patientId),
      }),
      queryClient.invalidateQueries({
        queryKey: medicalProfileKey(patientId),
      }),
      queryClient.invalidateQueries({ queryKey: ["patients"] }),
    ]);
  };
  const path = { params: { path: { patient_id: patientId } } };

  const endTherapy = useMutation({
    mutationFn: async (body: TherapyEndBody) => {
      const { error } = await api.PUT(
        "/api/v1/patients/{patient_id}/therapy-end",
        { ...path, body },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const resumeTherapy = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/therapy-end",
        path,
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const buildSchedule = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/control-visits/schedule",
        path,
      );
      if (error || !data) throw error ?? new Error("Empty schedule response");
      return data;
    },
    onSuccess: invalidate,
  });

  const addVisit = useMutation({
    mutationFn: async (body: ControlVisitCreate) => {
      const { error } = await api.POST(
        "/api/v1/patients/{patient_id}/control-visits",
        { ...path, body },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateVisit = useMutation({
    mutationFn: async ({
      visitId,
      body,
    }: {
      visitId: string;
      body: ControlVisitUpdate;
    }) => {
      const { error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/control-visits/{visit_id}",
        {
          params: { path: { patient_id: patientId, visit_id: visitId } },
          body,
        },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteVisit = useMutation({
    mutationFn: async (visitId: string) => {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/control-visits/{visit_id}",
        { params: { path: { patient_id: patientId, visit_id: visitId } } },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    endTherapy,
    resumeTherapy,
    buildSchedule,
    addVisit,
    updateVisit,
    deleteVisit,
  };
}
