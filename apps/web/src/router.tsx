import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { LoginPage } from "./features/auth/LoginPage";
import { AcceptInvitePage } from "./features/invitations/AcceptInvitePage";
import { SECTIONS_BY_ROLE, type Role } from "./features/auth/roles";
import type { Session } from "./features/auth/claims";
import { AppLayout } from "./layouts/AppLayout";
import { SectionRoute } from "./routes/SectionRoute";

export interface RouterContext {
  /** null — не аутентифицирован. Роутер не монтируется, пока сессия восстанавливается. */
  session: Session | null;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ context }) => {
    throw redirect({ to: context.session === null ? "/login" : "/app" });
  },
  component: () => null,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
  beforeLoad: ({ context }) => {
    if (context.session !== null) throw redirect({ to: "/app" });
  },
});

/**
 * Guard кабинета. Это UX, а не безопасность: доступ к данным проверяет сервер
 * на каждом запросе (правило 5 CLAUDE.md). Здесь — чтобы неаутентифицированный
 * пользователь не видел пустой каркас вместо формы входа.
 */
/**
 * Принятие приглашения — публичный маршрут: пользователя, который по нему
 * приходит, ещё не существует. Проверять токен здесь нечем и незачем, это
 * делает сервер.
 */
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite",
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    const token = search.token;
    return typeof token === "string" && token !== "" ? { token } : {};
  },
  component: AcceptInvitePage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  component: AppLayout,
  beforeLoad: ({ context }) => {
    if (context.session === null) throw redirect({ to: "/login" });
  },
});

function firstSectionFor(role: Role): string {
  const sections = SECTIONS_BY_ROLE[role];
  return sections[0] ?? "settings";
}

const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  beforeLoad: ({ context }) => {
    if (context.session) {
      throw redirect({
        to: "/app/$section",
        params: { section: firstSectionFor(context.session.role) },
      });
    }
  },
  component: () => null,
});

/**
 * Один параметризованный маршрут вместо набора статических: список разделов
 * зависит от роли, и генерация путей строками обходила бы типизацию роутера.
 */
export interface SectionSearch {
  /** Выбранный ребёнок. В адресе, а не в состоянии: ссылка на экран должна
      однозначно говорить, о ком она, — иначе присланная врачу или второму
      родителю ссылка откроет данные другого ребёнка. */
  patient?: string;
  /** Вид дневника: быстрая кнопка главной открывает нужную вкладку сразу. */
  kind?: string;
}

const sectionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "$section",
  validateSearch: (search: Record<string, unknown>): SectionSearch => {
    const patient = search.patient;
    return typeof patient === "string" && patient !== "" ? { patient } : {};
  },
  beforeLoad: ({ context, params }) => {
    const role = context.session?.role;
    if (!role) return;

    // Раздел, недоступный роли, — не ошибка, а устаревшая ссылка: уводим на
    // первый доступный, а не показываем 404.
    if (!SECTIONS_BY_ROLE[role].includes(params.section)) {
      throw redirect({
        to: "/app/$section",
        params: { section: firstSectionFor(role) },
      });
    }
  },
  component: SectionRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  inviteRoute,
  appRoute.addChildren([appIndexRoute, sectionRoute]),
]);

export const router = createRouter({
  routeTree,
  context: { session: null },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
