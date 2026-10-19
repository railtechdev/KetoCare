import {
  Button,
  Separator,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  TooltipProvider,
  cn,
} from "@ketocare/ui";
import { Outlet, useMatchRoute } from "@tanstack/react-router";
import { Activity, Menu, X } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";

import { AccountNotices } from "../features/auth/AccountNotices";
import { type Role, SECTIONS_BY_ROLE } from "../features/auth/roles";
import { NAV } from "./navWidth";
import { useSession } from "../features/auth/useSession";
import { isPatientView } from "../features/doctor/patientViews";
import { PatientSwitcher } from "../features/patients/PatientSwitcher";
import {
  PRIMARY_MOBILE_SECTIONS,
  SECTION_ICONS,
} from "../routes/sections";
import { SectionLink } from "../components/SectionLink";
import { AppToaster } from "./AppToaster";
import { SidebarNav } from "./SidebarNav";
import { MAIN_CONTENT_ID, SkipLink } from "./SkipLink";
import { UserMenu } from "./UserMenu";

/**
 * Переключатель пациента едет отдельным куском: он нужен только внутри карты,
 * а каркас грузится всем — родителю на телефоне вместе с ним приезжал бы поиск
 * по когорте, которого у него нет и быть не может.
 */
const DoctorPatientSwitcher = lazy(() =>
  import("../features/doctor/DoctorPatientSwitcher").then((m) => ({
    default: m.DoctorPatientSwitcher,
  })),
);

/**
 * Каркас кабинета. Один билд на три роли (раздел 8.1 ТЗ): недоступные разделы
 * не рендерятся, но это только UX — доступ проверяет сервер.
 *
 * На узком экране навигация уезжает в шторку: родитель заполняет дневник с
 * телефона, и это основной сценарий, а не запасной.
 *
 * Три ширины, а не две. Раньше их было две — «телефон» и «1024 и шире», — и
 * между ними лежал провал: на 1000 px (ноутбук в окне, планшет альбомом)
 * приложение показывало телефонную раскладку с гамбургером, отдавая всю ширину
 * одной колонке. Теперь с 768 px боковая панель возвращается полосой значков, а
 * подписи к ним появляются с 1024 px, когда для них есть место.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const { session } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  const matchRoute = useMatchRoute();

  // Карта пациента — уровень глубже разделов, и каркас об этом знает: он
  // сжимает своё меню и подставляет в шапку переключатель пациента. Спросить
  // об этом роутер честнее, чем передавать признак через контекст: адрес и есть
  // источник правды о том, где пользователь находится.
  const inPatient =
    matchRoute({ to: "/app/patients/$patientId", fuzzy: true }) !== false;
  const openView = matchRoute({ to: "/app/patients/$patientId/$view" });

  if (session === null) return null;

  const sections = SECTIONS_BY_ROLE[session.role];
  const nav = inPatient ? NAV.patient : NAV.sections;

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-background">
        <SkipLink />
        <aside
          className={cn(
            "fixed inset-y-0 left-0 hidden flex-col gap-screen border-r border-sidebar-border bg-sidebar p-2 md:flex",
            !inPatient && "lg:p-4",
            nav.aside,
          )}
        >
          <Brand labels={inPatient ? "never" : "responsive"} />
          <SidebarNav
            sections={sections}
            labels={inPatient ? "never" : "responsive"}
          />
        </aside>

        <div className={nav.content}>
          <header className="sticky top-0 z-20 flex h-16 items-center gap-section border-b border-border bg-card px-4 sm:px-6">
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label={t("nav.openMenu")}
                >
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              {/* Своя кнопка закрытия: встроенная у кита подписана по-английски
                  («Close») и так зачитывалась в русском интерфейсе. */}
              <SheetContent
                side="left"
                className="w-72 p-4"
                showCloseButton={false}
              >
                <SheetTitle className="sr-only">{t("app.name")}</SheetTitle>
                <div className="flex items-center justify-between gap-2">
                  <Brand labels="always" />
                  <SheetClose asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("nav.closeMenu")}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </SheetClose>
                </div>
                <Separator className="my-4" />
                <SidebarNav
                  sections={sections}
                  labels="always"
                  onNavigate={() => setNavOpen(false)}
                />
              </SheetContent>
            </Sheet>

            <div className="mr-auto min-w-0">
              {session.role === "parent" && <PatientSwitcher />}
              {/* Чья карта открыта — видно в любом разделе и на любой ширине, в
                  том числе на телефоне, где навигация карты уезжает под
                  содержимое. Он же — переход к следующему пациенту. */}
              {openView !== false && isPatientView(openView.view) && (
                // Пока чанк едет, в шапке пусто, а не заглушка: имя пациента
                // всё это время видно в навигации карты, и мигающий скелетон на
                // его месте сообщал бы о загрузке того, что уже показано.
                <Suspense fallback={null}>
                  <DoctorPatientSwitcher
                    patientId={openView.patientId}
                    view={openView.view}
                  />
                </Suspense>
              )}
            </div>

            <UserMenu session={session} />
          </header>

          {/* Фокус сюда ставит только ссылка в обход навигации: рамка вокруг
              всей страницы ничего не сообщает, прокрутка уже показала цель.
              Нижний отступ pb-24 на мобильных экранах гарантирует, что фиксированный
              нижний бар навигации не перекроет кнопки действий или формы. */}
          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="p-4 pb-24 outline-none sm:p-6 md:pb-6 xl:px-8"
          >
            <AccountNotices userId={session.userId} />
            <Outlet />
          </main>
        </div>

        {/* Быстрый нижний бар для мобильных экранов (< 768 px) */}
        <MobileBottomNav
          role={session.role}
          onOpenMore={() => setNavOpen(true)}
        />

        <AppToaster />
      </div>
    </TooltipProvider>
  );
}

/**
 * Быстрая нижняя навигация для мобильных экранов (раздел 8.2 ТЗ).
 *
 * Отображает 4 основных раздела роли + кнопку «Ещё» (открытие полной шторки),
 * позволяя родителю и врачу управлять интерфейсом одной рукой без лишних кликов
 * в гамбургер-меню.
 */
function MobileBottomNav({
  role,
  onOpenMore,
}: {
  role: Role;
  onOpenMore: () => void;
}) {
  const { t } = useTranslation();
  const primarySections = PRIMARY_MOBILE_SECTIONS[role] ?? [];

  return (
    <nav
      aria-label={t("nav.quickNav")}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-sidebar-border bg-sidebar/95 pb-[var(--safe-bottom,0px)] backdrop-blur-xs md:hidden"
    >
      <ul className="m-0 flex list-none items-center justify-around p-0">
        {primarySections.map((section) => {
          const Icon = SECTION_ICONS[section];
          const label = t(`nav.${section}`);

          return (
            <li key={section} className="flex-1">
              <SectionLink
                section={section}
                className={cn(
                  "flex min-h-touch flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center text-sidebar-foreground/75 transition-colors no-underline",
                  "hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                activeProps={{
                  className: "text-primary font-semibold",
                }}
              >
                {Icon && (
                  <Icon aria-hidden="true" className="size-5 shrink-0" />
                )}
                <span className="w-full truncate text-[11px] leading-tight">
                  {label}
                </span>
              </SectionLink>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={onOpenMore}
            aria-label={t("nav.openMenu")}
            className={cn(
              "flex min-h-touch w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center text-sidebar-foreground/75 transition-colors",
              "hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Menu aria-hidden="true" className="size-5 shrink-0" />
            <span className="w-full truncate text-[11px] leading-tight">
              {t("nav.more")}
            </span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/**
 * Знак и название. Там, где подпись скрыта визуально, она остаётся
 * скринридеру: полоса значков — та же навигация, и она обязана называть, куда
 * пользователь попал.
 */
function Brand({ labels }: { labels: "responsive" | "always" | "never" }) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-field",
        labels === "responsive" && "lg:justify-start",
        labels === "always" && "justify-start",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Activity aria-hidden="true" className="size-5" />
      </span>
      <span
        className={cn(
          "text-lg font-bold text-foreground",
          labels === "responsive" && "sr-only lg:not-sr-only",
          labels === "never" && "sr-only",
        )}
      >
        {t("app.name")}
      </span>
    </div>
  );
}
