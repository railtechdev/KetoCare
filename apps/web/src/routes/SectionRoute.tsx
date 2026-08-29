import { useParams } from "@tanstack/react-router";

import { useSession } from "../features/auth/useSession";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SECTION_SCREENS } from "./sections";

/** Компонент маршрута раздела: сопоставляет параметр пути с экраном. */
export function SectionRoute() {
  const { section } = useParams({ from: "/app/$section" });
  const { session } = useSession();

  const screen = SECTION_SCREENS[section];
  if (screen) return screen(session?.role);

  return <SectionPlaceholder section={section} />;
}
