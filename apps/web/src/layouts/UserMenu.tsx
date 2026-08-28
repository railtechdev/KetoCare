import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ketocare/ui";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Session } from "../features/auth/claims";
import { useMe } from "../features/auth/useMe";
import { useSession } from "../features/auth/useSession";
import { initialsOf } from "./initials";

export function UserMenu({ session }: { session: Session }) {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const navigate = useNavigate();
  const me = useMe();

  // Пока профиль грузится, показывается роль: пустое место в шапке читается как
  // сбой, а роль пользователь про себя и так знает.
  const fullName = me.data?.full_name ?? null;
  const name = fullName ?? t(`roles.${session.role}`);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="min-h-touch gap-2 px-2"
          aria-label={t("nav.account")}
        >
          <Avatar className="size-8">
            <AvatarFallback>{initialsOf(fullName)}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block font-medium">{name}</span>
          <span className="block text-xs text-muted-foreground">
            {t(`roles.${session.role}`)}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => {
            void navigate({
              to: "/app/$section",
              params: { section: "profile" },
              search: (previous) => previous,
            });
          }}
        >
          <UserRound aria-hidden="true" />
          {t("nav.profile")}
        </DropdownMenuItem>

        {session.role === "parent" && (
          <DropdownMenuItem
            onSelect={() => {
              void navigate({
                to: "/app/$section",
                params: { section: "settings" },
                search: (previous) => previous,
              });
            }}
          >
            <Settings aria-hidden="true" />
            {t("nav.settings")}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          {t("nav.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
