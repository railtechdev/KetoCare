import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  createRoute,
} from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import type { PatientSearch } from "../router";

/**
 * Обёртка для тестов экранов карты пациента.
 *
 * Карта живёт по адресу `/app/patients/<id>/<раздел>`, и её экраны спрашивают
 * у роутера, кто открыт и какой раздел. Дерево здесь повторяет боевое ровно в
 * той части, которая экранам нужна, — вместе с разделом `/app/$section`: из
 * карты есть ссылка обратно в реестр, и без этого маршрута она бы не собралась.
 */
export function PatientRouter({
  children,
  patientId = "p1",
  view = "summary",
  search = {},
}: {
  children: ReactNode;
  patientId?: string;
  view?: string;
  search?: PatientSearch;
}) {
  // Роутер создаётся один раз: новый на каждый рендер сбрасывал бы историю и
  // уводил тест в бесконечную перерисовку.
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: Outlet });
    const appRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/app",
      component: Outlet,
    });
    const sectionRoute = createRoute({
      getParentRoute: () => appRoute,
      path: "$section",
      validateSearch: (value: Record<string, unknown>) => value,
      component: () => null,
    });
    const patientRoute = createRoute({
      getParentRoute: () => appRoute,
      path: "patients/$patientId",
      validateSearch: (value: Record<string, unknown>): PatientSearch => value,
      component: Outlet,
    });
    const viewRoute = createRoute({
      getParentRoute: () => patientRoute,
      path: "$view",
      component: () => <>{children}</>,
    });

    const query = new URLSearchParams(
      Object.entries(search).filter(([, value]) => value !== undefined) as [
        string,
        string,
      ][],
    ).toString();

    return createRouter({
      routeTree: rootRoute.addChildren([
        appRoute.addChildren([
          sectionRoute,
          patientRoute.addChildren([viewRoute]),
        ]),
      ]),
      history: createMemoryHistory({
        initialEntries: [
          `/app/patients/${patientId}/${view}${query === "" ? "" : `?${query}`}`,
        ],
      }),
    });
  });

  // Дерево теста уже, чем боевое, поэтому типы маршрутов не совпадают:
  // `RouterProvider` типизирован зарегистрированным роутером приложения.
  return <RouterProvider router={router as never} />;
}
