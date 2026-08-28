import { useState } from "react";

import { PatientCard } from "./PatientCard";
import { PatientsListView } from "./PatientsListView";
import type { Patient } from "./types";

/**
 * Кабинет врача: список пациентов и карта пациента (раздел 8.1 ТЗ, раздел
 * `/app (doctor)`).
 *
 * Список и карта живут в одном разделе маршрута: `/app/$section` не знает о
 * вложенных путях, поэтому что показывать, решает состояние экрана.
 */
export function DoctorPatientsPage() {
  const [selected, setSelected] = useState<Patient | null>(null);

  if (selected !== null) {
    return <PatientCard patient={selected} onBack={() => setSelected(null)} />;
  }

  return <PatientsListView onOpen={setSelected} />;
}
