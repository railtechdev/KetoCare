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

import { SECTIONS_BY_ROLE } from "../features/auth/roles";
import { NAV } from "./navWidth";
import { useSession } from "../features/auth/useSession";
import { isPatientView } from "../features/doctor/patientViews";
import { PatientSwitcher } from "../features/patients/PatientSwitcher";
import { AppToaster } from "./AppToaster";
import { SidebarNav } from "./SidebarNav";
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
          <header className="sticky top-0 z-20 flex h-16 items-center gap-block border-b border-border bg-card px-4 sm:px-6">
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

          <main className="p-4 sm:p-6 xl:px-8">
            <Outlet />
          </main>
        </div>

        <AppToaster />
      </div>
    </TooltipProvider>
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
