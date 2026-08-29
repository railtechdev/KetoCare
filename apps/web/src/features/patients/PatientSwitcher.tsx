import { useId } from "react";
import { useTranslation } from "react-i18next";

import { FIELD_CONTROL } from "../../components/Field";
import { useSelectedPatient } from "./useSelectedPatient";

/**
 * Выбор ребёнка в шапке кабинета.
 *
 * Не рендерится, когда ребёнок один: выбирать не из чего, а лишний элемент в
 * шапке отвлекает от того, ради чего экран открыт.
 */
export function PatientSwitcher() {
  const { t } = useTranslation();
  const { patients, patientId, select } = useSelectedPatient();
  const id = useId();

  if (patients.length <= 1) return null;

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
        {patientId === null && (
          <option value="">{t("nav.patientPlaceholder")}</option>
        )}
        {patients.map((patient) => (
          <option key={patient.id} value={patient.id}>
            {patient.full_name}
          </option>
        ))}
      </select>
    </div>
  );
}
