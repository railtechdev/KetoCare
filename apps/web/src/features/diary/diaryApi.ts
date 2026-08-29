import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";
import type { DiaryRange } from "./time";

type Schemas = components["schemas"];

/**
 * Дневники (раздел 5.3 ТЗ, группа `/logs`).
 *
 * Ручки разведены по видам записей, и клиент повторяет это разделение: на каждый
 * вид — своя ветка с точным типом тела и ответа. Обобщённый вызов с путём,
 * собранным из строки, потребовал бы приведений типов, а вместе с ними исчезла
 * бы единственная защита от того, чтобы отправить в дневник кетонов поле веса.
 */
export const DIARY_KINDS = [
  "seizures",
  "ketones",
  "weight",
  "medications",
  "meals",
  "side-effects",
] as const;

export type DiaryKind = (typeof DIARY_KINDS)[number];

/** Виды, для которых раздел 8.3 ТЗ требует график динамики. */
export const CHART_KINDS: readonly DiaryKind[] = ["ketones", "weight"];

/** Запись дневника с меткой вида — метка разводит union при отрисовке. */
export type DiaryLog =
  | ({ kind: "seizures" } & Schemas["SeizureLogRead"])
  | ({ kind: "ketones" } & Schemas["KetoneLogRead"])
  | ({ kind: "weight" } & Schemas["WeightLogRead"])
  | ({ kind: "medications" } & Schemas["MedicationLogRead"])
  | ({ kind: "meals" } & Schemas["MealLogRead"])
  | ({ kind: "side-effects" } & Schemas["SideEffectLogRead"]);

/**
 * Тело записи из формы.
 *
 * Одно и то же тело годится и для POST, и для PATCH: схема изменения повторяет
 * схему создания, но с необязательными полями. Форма показывает все поля сразу,
 * поэтому и при изменении отправляются все — очищенное поле должно очиститься.
 */
export type DiaryBody =
  | { kind: "seizures"; body: Schemas["SeizureLogCreate"] }
  | { kind: "ketones"; body: Schemas["KetoneLogCreate"] }
  | { kind: "weight"; body: Schemas["WeightLogCreate"] }
  | { kind: "medications"; body: Schemas["MedicationLogCreate"] }
  | { kind: "meals"; body: Schemas["MealLogCreate"] }
  | { kind: "side-effects"; body: Schemas["SideEffectLogCreate"] };

export interface DiaryPage {
  items: DiaryLog[];
  /** Всего записей за период — больше длины items, если выдача обрезана страницей. */
  total: number;
}

/** Верхняя граница страницы на сервере (`MAX_PAGE_SIZE`, раздел 5.1 ТЗ). */
export const DIARY_PAGE_LIMIT = 200;

export async function fetchDiaryLogs(
  patientId: string,
  kind: DiaryKind,
  range: DiaryRange,
): Promise<DiaryPage> {
  const params = {
    path: { patient_id: patientId },
    query: {
      from: range.from,
      to: range.to,
      limit: DIARY_PAGE_LIMIT,
      offset: 0,
    },
  };

  switch (kind) {
    case "seizures": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/seizures",
        { params },
      );
      if (error || !data) throw error ?? new Error("Empty seizures response");
      return {
        items: data.items.map((item) => ({ kind, ...item })),
        total: data.total,
      };
    }
    case "ketones": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/ketones",
        { params },
      );
      if (error || !data) throw error ?? new Error("Empty ketones response");
      return {
        items: data.items.map((item) => ({ kind, ...item })),
        total: data.total,
      };
    }
    case "weight": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/weight",
        { params },
      );
      if (error || !data) throw error ?? new Error("Empty weight response");
      return {
        items: data.items.map((item) => ({ kind, ...item })),
        total: data.total,
      };
    }
    case "medications": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/medications",
        { params },
      );
      if (error || !data)
        throw error ?? new Error("Empty medication logs response");
      return {
        items: data.items.map((item) => ({ kind, ...item })),
        total: data.total,
      };
    }
    case "meals": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/meals",
        { params },
      );
      if (error || !data) throw error ?? new Error("Empty meal logs response");
      return {
        items: data.items.map((item) => ({ kind, ...item })),
        total: data.total,
      };
    }
    case "side-effects": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/side-effects",
        { params },
      );
      if (error || !data)
        throw error ?? new Error("Empty side effect logs response");
      return {
        items: data.items.map((item) => ({ kind, ...item })),
        total: data.total,
      };
    }
  }
}

export async function createDiaryLog(
  patientId: string,
  input: DiaryBody,
): Promise<void> {
  const params = { path: { patient_id: patientId } };

  switch (input.kind) {
    case "seizures": {
      const { error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/seizures",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "ketones": {
      const { error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/ketones",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "weight": {
      const { error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/weight",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "medications": {
      const { error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/medications",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "meals": {
      const { error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/meals",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "side-effects": {
      const { error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/side-effects",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
  }
}

export async function updateDiaryLog(
  patientId: string,
  logId: string,
  input: DiaryBody,
): Promise<void> {
  const params = { path: { patient_id: patientId, log_id: logId } };

  switch (input.kind) {
    case "seizures": {
      const { error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/seizures/{log_id}",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "ketones": {
      const { error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/ketones/{log_id}",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "weight": {
      const { error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/weight/{log_id}",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "medications": {
      const { error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/medications/{log_id}",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "meals": {
      const { error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/meals/{log_id}",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
    case "side-effects": {
      const { error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/side-effects/{log_id}",
        { params, body: input.body },
      );
      if (error) throw error;
      return;
    }
  }
}

/** Мягкое удаление: запись остаётся в БД с `deleted_at` (правило 4 CLAUDE.md). */
export async function deleteDiaryLog(
  patientId: string,
  kind: DiaryKind,
  logId: string,
): Promise<void> {
  const params = { path: { patient_id: patientId, log_id: logId } };

  switch (kind) {
    case "seizures": {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/seizures/{log_id}",
        { params },
      );
      if (error) throw error;
      return;
    }
    case "ketones": {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/ketones/{log_id}",
        { params },
      );
      if (error) throw error;
      return;
    }
    case "weight": {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/weight/{log_id}",
        { params },
      );
      if (error) throw error;
      return;
    }
    case "medications": {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/medications/{log_id}",
        { params },
      );
      if (error) throw error;
      return;
    }
    case "meals": {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/meals/{log_id}",
        { params },
      );
      if (error) throw error;
      return;
    }
    case "side-effects": {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/side-effects/{log_id}",
        { params },
      );
      if (error) throw error;
      return;
    }
  }
}
