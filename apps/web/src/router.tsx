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
import {
  DEFAULT_PATIENT_VIEW,
  isPatientView,
  patientViewFromTab,
  patientViewsFor,
} from "./features/doctor/patientViews";
import { AppLayout } from "./layouts/AppLayout";
import { UiShowcase } from "./routes/UiShowcase";
import { NotFoundPage } from "./routes/NotFoundPage";
import { PatientRoute } from "./routes/PatientRoute";
import { PatientViewRoute } from "./routes/PatientViewRoute";
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

/**
 * Один параметризованный маршрут вместо набора статических: список разделов
 * зависит от роли, и генерация путей строками обходила бы типизацию роутера.
 */
export interface SectionSearch {
  /** Выбранный ребёнок. В адресе, а не в состоянии: ссылка на экран должна
      однозначно говорить, о ком она, — иначе присланная врачу или второму
      родителю ссылка откроет данные другого ребёнка. */
  patient?: string;
  /** Вкладка экрана: параллельные виды одного объекта (правило П30 канона). */
  tab?: string;
  /** Разновидность внутри вкладки: вид дневника, выбранный справочник. */
  kind?: string;
  /**
   * Объект или задача второго уровня внутри раздела: открытый продукт
   * (`item=<id>`), заведение новой позиции (`item=new`), импорт
   * (`item=import`).
   *
   * В адресе, а не в состоянии экрана: правило П1 канона требует адрес у
   * каждого объекта второго уровня. Пока параметра не было, администратор,
   * правивший продукт, не мог ни переслать ссылку коллеге, ни обновить
   * страницу — F5 возвращал в список, а «Назад» браузера уводил из раздела.
   */
  item?: string;
  /**
   * Задача сборки PDF-отчёта.
   *
   * В адресе, а не в состоянии экрана: сборка идёт в воркере секундами, и до
   * этого параметра её идентификатор терялся при обновлении страницы, переходе
   * в другой раздел и возврате. Готовый файл после этого достать было нечем —
   * ручки «мои задачи» у API нет, только выдача по идентификатору, — и человек
   * заказывал сборку заново, второй раз занимая воркер.
   *
   * Тот же класс, что потерянная переписка помощника: то, что живёт на
   * сервере, не должно существовать только в памяти вкладки.
   */
  job?: string;
  /**
   * Строка поиска раздела.
   *
   * В адресе, потому что поиск — это ссылка: калькулятор, не нашедший продукт,
   * отправляет в справочник с тем же запросом, и переспрашивать его у семьи,
   * стоящей у плиты, незачем.
   */
  q?: string;
}

/** Непустая строка или ничего: `?tab=` в адресе — то же самое, что его отсутствие. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

const sectionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "$section",
  // Всё, что экран показывает, должно быть в адресе (правила П1 и П30):
  // ссылку можно переслать, F5 не сбрасывает выбор. Параметр, не перечисленный
  // здесь, TanStack Router молча выбрасывает — так `kind` и терялся, из-за чего
  // быстрые кнопки главной («Записать кетоны») открывали дневник на чужой
  // вкладке.
  validateSearch: (search: Record<string, unknown>): SectionSearch => {
    const result: SectionSearch = {};
    const patient = text(search.patient);
    const tab = text(search.tab);
    const kind = text(search.kind);
    const item = text(search.item);
    const q = text(search.q);
    const job = text(search.job);
    if (patient !== undefined) result.patient = patient;
    if (tab !== undefined) result.tab = tab;
    if (kind !== undefined) result.kind = kind;
    if (item !== undefined) result.item = item;
    if (q !== undefined) result.q = q;
    if (job !== undefined) result.job = job;
    return result;
  },
  beforeLoad: ({ context, params, search }) => {
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
 * Параметры адреса внутри карты пациента.
 *
 * Их два, и оба уже были у раздела: вид дневника и задача сборки отчёта.
 * Вкладки (`?tab=`) здесь нет — её место занял уровень пути, а `?patient=`
 * незачем: пациент и есть путь.
 */
export interface PatientSearch {
  /** Вид дневника внутри раздела «Дневники» */
  kind?: string;
  /**
   * Предмет, открытый внутри раздела: продукт или готовое блюдо, пришедшее в
   * калькулятор (`item=dish:<id>`). Тем же параметром состав, собранный в общем
   * калькуляторе, попадает в карту пациента.
   */
  item?: string;
  /**
   * Задача сборки PDF-отчёта. В адресе по той же причине, что и в разделах:
   * сборка идёт в воркере секундами, а ручки «мои задачи» у API нет — потеряв
   * идентификатор, готовый файл достать нечем.
   */
  job?: string;
}

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
  validateSearch: (search: Record<string, unknown>): PatientSearch => {
    const result: PatientSearch = {};
    const kind = text(search.kind);
    const item = text(search.item);
    const job = text(search.job);
    if (kind !== undefined) result.kind = kind;
    if (item !== undefined) result.item = item;
    if (job !== undefined) result.job = job;
    return result;
  },
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
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
