import { Button, EmptyState } from "@ketocare/ui";
import { Link } from "@tanstack/react-router";
import { MapPinOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSession } from "../features/auth/useSession";

/**
 * Несуществующий адрес.
 *
 * До этого маршрутизатор показывал собственную заглушку — англоязычную строку
 * без единой ссылки. Человек, пришедший по устаревшей ссылке из письма или
 * опечатавшийся в адресе, упирался в стену: ни объяснения, ни выхода, кроме
 * кнопки «назад» браузера.
 *
 * Выход зависит от того, вошёл ли человек: вошедшего ведём в кабинет, гостя —
 * на вход, потому что кабинет ему всё равно откажет.
 */
export function NotFoundPage() {
  const { t } = useTranslation("common");
  const { session } = useSession();

  return (
    <div className="flex min-h-dvh items-center justify-center p-screen">
      <div className="w-full max-w-form">
        <EmptyState
          icon={MapPinOff}
          title={t("notFound.title")}
          description={t("notFound.description")}
          action={
            <Button asChild>
              <Link to={session ? "/app" : "/login"}>
                {session ? t("notFound.toApp") : t("notFound.toLogin")}
              </Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
