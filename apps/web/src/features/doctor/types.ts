import type { components } from "@ketocare/api-client";

import type { Role } from "../auth/roles";

type Schemas = components["schemas"];

export type Patient = Schemas["PatientRead"];
export type PatientOverview = Schemas["PatientOverview"];
export type Prescription = Schemas["PrescriptionRead"];
export type PrescriptionBody = Schemas["PrescriptionCreate"];
export type MedicalProfile = Schemas["MedicalProfileRead"];
export type MedicalProfileBody = Schemas["MedicalProfileWrite"];
export type Medication = Schemas["MedicationRead"];
export type MedicationBody = Schemas["MedicationWrite"];
export type ClinicalNote = Schemas["ClinicalNoteRead"];
export type Colleague = Schemas["ColleagueRead"];

/**
 * Назначение вместе с номером версии.
 *
 * Номера версий сервер не хранит: `prescriptions` append-only, версия — это
 * порядковый номер строки по времени создания (раздел 4.2 ТЗ). История приходит
 * от новых к старым, поэтому у первого элемента номер равен общему числу версий.
 */
export interface PrescriptionVersion {
  version: number;
  prescription: Prescription;
}

/** Верхняя граница страницы на сервере (`MAX_PAGE_SIZE`, раздел 5.1 ТЗ). */
export const DOCTOR_PAGE_LIMIT = 200;

/**
 * Роль, которой сервер открывает клинические ручки пациента: медицинский профиль
 * (чтение и запись), врачебные заметки, изменение схемы терапии (`clinical.py`).
 *
 * Раздел «Пациенты» по разделу 8.1 ТЗ виден ещё и диетологу, поэтому проверка
 * нужна: без неё диетолог открывал бы вкладки, отвечающие 403. Это UX — права
 * проверяет сервер (правило 5 CLAUDE.md).
 */
export function isDoctor(role: Role | undefined): boolean {
  return role === "doctor";
}

/**
 * Специалист, ведущий пациентов, — `CARE_ROLES` на сервере.
 *
 * Одно определение на все проверки этой пары ролей: две одинаковые проверки
 * под разными именами со временем разошлись бы, и одна из них разрешила бы
 * действие, которое сервер отвергает.
 */
export function isCareRole(role: Role | undefined): boolean {
  return role === "doctor" || role === "dietitian";
}

/** Назначения создают врач и диетолог (`prescriptions.py`). */
export function canWritePrescriptions(role: Role | undefined): boolean {
  return isCareRole(role);
}
