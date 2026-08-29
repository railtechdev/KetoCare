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
 */
export function AppLayout() {
  const { t } = useTranslation();
  const { session } = useSession();
  const [navOpen, setNavOpen] = useState(false);

  if (session === null) return null;

  const sections = SECTIONS_BY_ROLE[session.role];

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-screen border-r border-sidebar-border bg-sidebar p-4 lg:flex">
          <Brand />
          <SidebarNav sections={sections} />
        </aside>

        <div className="lg:pl-64">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-block border-b border-border bg-card px-4 sm:px-6">
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
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
                  onNavigate={() => setNavOpen(false)}
                />
              </SheetContent>
            </Sheet>

            <div className="mr-auto">
              {session.role === "parent" && <PatientSwitcher />}
            </div>

            <UserMenu session={session} />
          </header>

          <main className="p-4 sm:p-6">
            <Outlet />
          </main>
        </div>

        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

function Brand() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-field">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Activity aria-hidden="true" className="size-5" />
      </span>
      <span className="text-lg font-bold text-foreground">{t("app.name")}</span>
    </div>
  );
}
