import { useParams } from "@tanstack/react-router";

import { CalculatorPage } from "../features/calculator/CalculatorPage";
import { ProductsPage } from "../features/products/ProductsPage";
import { SectionPlaceholder } from "./SectionPlaceholder";

/** Компонент маршрута раздела: сопоставляет параметр пути с экраном. */
export function SectionRoute() {
  const { section } = useParams({ from: "/app/$section" });

  if (section === "calculator") return <CalculatorPage />;
  if (section === "products") return <ProductsPage />;

  // Остальные разделы наполняются пп. 10-14 раздела 15 ТЗ
  return <SectionPlaceholder section={section} />;
}
