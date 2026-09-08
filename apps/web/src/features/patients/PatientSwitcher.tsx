import { useId } from "react";
import { useTranslation } from "react-i18next";

import { FIELD_CONTROL } from "../../components/Field";
import { useSelectedPatient } from "./useSelectedPatient";

/**
 * Выбор ребёнка в шапке кабинета.
 *
 * Не рендерится в двух случаях:
 *
 * - ребёнок один — выбирать не из чего, а лишний элемент в шапке отвлекает от
 *   того, ради чего экран открыт;
 * - ребёнок ещё не выбран — тогда выбор предлагает сам экран (`PatientGate`),
 *   и он объясняет, зачем это нужно. Два разных элемента управления с одним и
 *   тем же смыслом на одном экране — первое, что видел родитель после входа, и
 *   выбирать между ними ему было не из чего: они делают одно и то же.
 *   Переключатель — для смены выбора, а сменить пока нечего.
 */
export function PatientSwitcher() {
  const { t } = useTranslation();
  const { patients, patientId, select } = useSelectedPatient();
  const id = useId();

  if (patients.length <= 1) return null;
  if (patientId === null) return null;

  return (
    <div className="flex items-center gap-field">
      <label className="text-sm text-muted-foreground" htmlFor={id}>
        {t("nav.patient")}
      </label>
      <select
        id={id}
        value={patientId ?? ""}
        onChange={(event) => select(event.target.value)}
        className={`${FIELD_CONTROL} w-auto`}
      >
        {patients.map((patient) => (
          <option key={patient.id} value={patient.id}>
            {patient.full_name}
          </option>
        ))}
      </select>
    </div>
  );
}
