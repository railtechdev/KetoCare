import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  redirect,
} from "@tanstack/react-router";

import { LoginPage } from "./features/auth/LoginPage";
import { AcceptInvitePage } from "./features/invitations/AcceptInvitePage";
import { JoinPage } from "./features/access/JoinPage";
import { SECTIONS_BY_ROLE, type Role } from "./features/auth/roles";
import type { Session } from "./features/auth/claims";
import {
  DEFAULT_PATIENT_VIEW,
  isPatientView,
  patientViewFromTab,
  patientViewsFor,
} from "./features/doctor/patientViews";
import { AppLayout } from "./layouts/AppLayout";
import { UiShowcase } from "./routes/UiShowcase";
import { NotFoundPage } from "./routes/NotFoundPage";
import { RouteErrorPage } from "./routes/RouteErrorPage";
import { PatientRoute } from "./routes/PatientRoute";
import { PatientViewRoute } from "./routes/PatientViewRoute";
import { SectionRoute } from "./routes/SectionRoute";
import {
  text,
  validatePatientSearch,
  validateSectionSearch,
  type PatientSearch,
  type SectionSearch,
} from "./routes/search";

export type {
  FilterSearch,
  PatientSearch,
  PeriodSearch,
  SectionSearch,
  ViewStateSearch,
} from "./routes/search";

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

function LoginRouteScreen() {
  const { email } = loginRoute.useSearch();
  return <LoginPage initialEmail={email} />;
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  // `?email=` — почта, на которую только что завели учётную запись (по
  // приглашению или коду): переписывать её на входе незачем.
  validateSearch: (search: Record<string, unknown>): { email?: string } => {
    const email = text(search.email);
    return email === undefined ? {} : { email };
  },
  component: LoginRouteScreen,
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

/**
 * Активация кода доступа семьёй — публичный маршрут по той же причине, что и
 * принятие приглашения: пользователя ещё не существует (ADR-0040).
 */
const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/join",
  validateSearch: (search: Record<string, unknown>): { code?: string } => {
    const code = search.code;
    return typeof code === "string" && code !== "" ? { code } : {};
  },
  component: JoinPage,
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
  // Запасной вариант — свой профиль: он есть у любой роли, в отличие от
  // разделов, состав которых зависит от этапа.
  return sections[0] ?? "profile";
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

/** Разделы кабинета у всех ролей вместе: всё прочее — несуществующий адрес. */
const ALL_SECTIONS: ReadonlySet<string> = new Set(
  Object.values(SECTIONS_BY_ROLE).flat(),
);

const sectionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "$section",
  // Всё, что экран показывает, должно быть в адресе (правила П1 и П30):
  // ссылку можно переслать, F5 не сбрасывает выбор. Параметр, не перечисленный
  // здесь, TanStack Router молча выбрасывает — так `kind` и терялся, из-за чего
  // быстрые кнопки главной («Записать кетоны») открывали дневник на чужой
  // вкладке.
  validateSearch: (search: Record<string, unknown>): SectionSearch =>
    validateSectionSearch(search),
  beforeLoad: ({ context, params, search }) => {
    const role = context.session?.role;
    if (!role) return;

    // Раздела нет ни у одной роли — опечатка или ссылка из прошлого. Молча
    // увести на главную значило бы сделать вид, что ссылка сработала: человек
    // искал конкретный экран и не понимал, куда он делся.
    if (!ALL_SECTIONS.has(params.section)) throw notFound();

    // Раздел, недоступный роли, — не ошибка, а устаревшая ссылка: уводим на
    // первый доступный, а не показываем 404.
    if (!SECTIONS_BY_ROLE[role].includes(params.section)) {
      throw redirect({
        to: "/app/$section",
        params: { section: firstSectionFor(role) },
      });
    }

    // Прежний адрес карты пациента — `/app/patients?patient=<id>&tab=<вкладка>`.
    // Такие ссылки лежат в закладках и в переписке врачей, и оборвать их
    // значило бы обменять работающие ссылки на новую раскладку. Перевод — один
    // на все: и на очередь главной, и на письмо коллеге годовой давности.
    if (params.section === "patients" && search.patient !== undefined) {
      throw redirect({
        to: "/app/patients/$patientId/$view",
        params: {
          patientId: search.patient,
          view: patientViewFromTab(search.tab),
        },
        search: { kind: search.kind, item: search.item, job: search.job },
      });
    }
  },
  component: SectionRoute,
});

/**
 * Карта пациента — уровень пути, а не параметр списка.
 *
 * Разбор, из которого это выросло, — в `routes/PatientRoute.tsx`. Здесь важно
 * одно: `patients/$patientId` длиннее одного сегмента, поэтому со статическим
 * разделом `/app/patients` он не спорит — реестр остаётся на своём адресе.
 */

const patientRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "patients/$patientId",
  validateSearch: (search: Record<string, unknown>): PatientSearch =>
    validatePatientSearch(search),
  beforeLoad: ({ context }) => {
    const role = context.session?.role;
    if (!role) return;

    // Карта пациента — рабочее место специалиста. Семья ходит своими разделами,
    // и попавший сюда родитель получает свой кабинет, а не 404: доступ к данным
    // всё равно проверяет сервер (правило 5 CLAUDE.md), здесь только UX.
    if (!SECTIONS_BY_ROLE[role].includes("patients")) {
      throw redirect({
        to: "/app/$section",
        params: { section: firstSectionFor(role) },
      });
    }
  },
  component: PatientRoute,
});

const patientIndexRoute = createRoute({
  getParentRoute: () => patientRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    // Адрес без раздела — это «открой пациента»: ссылка, набранная руками, и
    // ссылка из письма без хвоста обязаны открывать карту, а не пустоту.
    throw redirect({
      to: "/app/patients/$patientId/$view",
      params: { patientId: params.patientId, view: DEFAULT_PATIENT_VIEW },
    });
  },
  component: () => null,
});

const patientViewRoute = createRoute({
  getParentRoute: () => patientRoute,
  path: "$view",
  beforeLoad: ({ context, params }) => {
    const role = context.session?.role;
    if (!role) return;

    // Раздел, которого нет или который роли не положен (заметки диетологу), —
    // это устаревшая ссылка, а не ошибка: уводим на сводку.
    if (
      !isPatientView(params.view) ||
      !patientViewsFor(role).includes(params.view)
    ) {
      throw redirect({
        to: "/app/patients/$patientId/$view",
        params: { patientId: params.patientId, view: DEFAULT_PATIENT_VIEW },
      });
    }
  },
  component: PatientViewRoute,
});

/**
 * Витрина компонентов (раздел 15, п. 8 ТЗ) — только в dev-сборке.
 *
 * `import.meta.env.DEV` вычисляется на этапе сборки, поэтому в production
 * маршрута нет вовсе, а не «есть, но закрыт».
 */
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/dev/ui",
        component: UiShowcase,
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  inviteRoute,
  joinRoute,
  ...devRoutes,
  appRoute.addChildren([
    appIndexRoute,
    sectionRoute,
    patientRoute.addChildren([patientIndexRoute, patientViewRoute]),
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { session: null },
  // Несуществующий адрес — свой экран с выходом, а не англоязычная заглушка
  // маршрутизатора без единой ссылки (правило П22 и здравый смысл: из тупика
  // должен быть выход).
  defaultNotFoundComponent: NotFoundPage,
  // Сбой при показе раздела — по-русски и с выходом. Самый частый повод — не
  // догрузившаяся часть приложения после выката: тогда страница один раз
  // перезагружается сама (`routes/chunkReload.ts`).
  defaultErrorComponent: RouteErrorPage,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
