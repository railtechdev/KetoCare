import {
  Button,
  Separator,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Toaster,
  TooltipProvider,
} from "@ketocare/ui";
import { Outlet } from "@tanstack/react-router";
import { Activity, Menu } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SECTIONS_BY_ROLE } from "../features/auth/roles";
import { useSession } from "../features/auth/useSession";
import { PatientSwitcher } from "../features/patients/PatientSwitcher";
import { SidebarNav } from "./SidebarNav";
import { UserMenu } from "./UserMenu";

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

  if (session === null) return null;

  const sections = SECTIONS_BY_ROLE[session.role];

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-background">
        {/* Полоса значков с 768 px, подписи — с 1024 px. Ширина панели и отступ
            содержимого обязаны совпадать: панель `fixed`, и расхождение между
            ними тут же уводит содержимое под неё. */}
        <aside className="fixed inset-y-0 left-0 hidden w-16 flex-col gap-screen border-r border-sidebar-border bg-sidebar p-2 md:flex lg:w-64 lg:p-4">
          <Brand />
          <SidebarNav sections={sections} />
        </aside>

        <div className="md:pl-16 lg:pl-64">
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
              <SheetContent side="left" className="w-72 p-4">
                <SheetTitle className="sr-only">{t("app.name")}</SheetTitle>
                <Brand />
                <Separator className="my-4" />
                <SidebarNav
                  sections={sections}
                  labels="always"
                  onNavigate={() => setNavOpen(false)}
                />
              </SheetContent>
            </Sheet>

            <div className="mr-auto">
              {session.role === "parent" && <PatientSwitcher />}
            </div>

            <UserMenu session={session} />
          </header>

          <main className="p-4 sm:p-6 xl:px-8">
            <Outlet />
          </main>
        </div>

        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

/**
 * Знак и название. На полосе значков название скрыто визуально, но остаётся
 * скринридеру: полоса — это та же навигация, и она обязана называть, куда
 * пользователь попал.
 */
function Brand() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-center gap-field lg:justify-start">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Activity aria-hidden="true" className="size-5" />
      </span>
      <span className="sr-only text-lg font-bold text-foreground lg:not-sr-only">
        {t("app.name")}
      </span>
    </div>
  );
}
