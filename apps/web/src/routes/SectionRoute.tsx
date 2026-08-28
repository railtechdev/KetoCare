import { useParams } from "@tanstack/react-router";

import { CalculatorPage } from "../features/calculator/CalculatorPage";
import { SectionPlaceholder } from "./SectionPlaceholder";

/** Компонент маршрута раздела: сопоставляет параметр пути с экраном. */
export function SectionRoute() {
  const { section } = useParams({ from: "/app/$section" });

  if (section === "calculator") return <CalculatorPage />;

  // Остальные разделы наполняются пп. 10-14 раздела 15 ТЗ
  return <SectionPlaceholder section={section} />;
}
