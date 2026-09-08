import { MedicationsTab } from "./MedicationsTab";
import { PrescriptionTab } from "./PrescriptionTab";

/**
 * Раздел «Назначение»: диета и схема препаратов.
 *
 * Два блока в одном разделе, а не два раздела: и то и другое — то, что назначил
 * врач, и разносить их значило бы требовать лишний переход между двумя
 * половинами одного решения. Так они и жили на одной вкладке карты; здесь
 * только сменилось место в навигации.
 */
export function PrescriptionView({ patientId }: { patientId: string }) {
  return (
    <div className="flex flex-col gap-block">
      <PrescriptionTab patientId={patientId} />
      <MedicationsTab patientId={patientId} />
    </div>
  );
}
