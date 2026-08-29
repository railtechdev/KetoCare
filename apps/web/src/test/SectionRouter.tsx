import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import type { SectionSearch } from "../router";

/**
 * Обёртка для тестов экранов, которые держат состояние в адресе.
 *
 * Вкладка экрана живёт в `?tab=` и `?kind=` (правило П30 канона), а значит
 * `useSearch`/`useNavigate` требуют контекста роутера. Тест, рендерящий экран
 * голым, падал бы на этом — и это правильно: без адреса экран работать не
 * должен. Дерево здесь повторяет боевое только в той части, которая экрану
 * нужна: `/app/$section` с теми же параметрами поиска.
 */
export function SectionRouter({
  children,
  section = "patients",
  search = {},
}: {
  children: ReactNode;
  section?: string;
  search?: SectionSearch;
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
      validateSearch: (value: Record<string, unknown>): SectionSearch => value,
      component: () => <>{children}</>,
    });

    const query = new URLSearchParams(
      Object.entries(search).filter(([, value]) => value !== undefined) as [
        string,
        string,
      ][],
    ).toString();

    return createRouter({
      routeTree: rootRoute.addChildren([appRoute.addChildren([sectionRoute])]),
      history: createMemoryHistory({
        initialEntries: [`/app/${section}${query === "" ? "" : `?${query}`}`],
      }),
    });
  });

  // Дерево теста уже, чем боевое, поэтому типы маршрутов не совпадают:
  // `RouterProvider` типизирован зарегистрированным роутером приложения.
  return <RouterProvider router={router as never} />;
}
