import type { components } from "@ketocare/api-client";

/**
 * Формы данных главной берутся из сгенерированной схемы, а не описываются
 * заново: ручная копия разойдётся с OpenAPI при первом изменении API, и экран
 * начнёт показывать поля, которых в ответе больше нет.
 */
export type PatientOverview = components["schemas"]["PatientOverview"];
export type PrescriptionRead = components["schemas"]["PrescriptionRead"];
export type DaySummary = components["schemas"]["DaySummary"];
export type KetoneReading = components["schemas"]["KetoneReading"];
export type WeightReading = components["schemas"]["WeightReading"];
export type SeizuresToday = components["schemas"]["SeizuresToday"];
