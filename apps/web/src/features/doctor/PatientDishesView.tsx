import { MyDishesPanel } from "../dishes/MyDishesPanel";

/** Блюда ребёнка отдельным разделом: с ними диетолог работает чаще всего. */
export function PatientDishesView({ patientId }: { patientId: string }) {
  return <MyDishesPanel patientId={patientId} openIn="card" />;
}
