import { useParams } from "@tanstack/react-router";

import { SectionPlaceholder } from "./SectionPlaceholder";

/** Компонент маршрута раздела: достаёт параметр и отдаёт его экрану. */
export function SectionRoute() {
  const { section } = useParams({ from: "/app/$section" });
  return <SectionPlaceholder section={section} />;
}
