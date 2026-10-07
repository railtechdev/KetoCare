import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  formatDayTime,
} from "@ketocare/ui";
import type { components } from "@ketocare/api-client";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";

export type AccountNotice = components["schemas"]["AccountNotice"];

/**
 * Ключ в браузере: момент самого свежего сообщения, которое человек закрыл.
 * Удобство одного браузера, а не хранилище — пропал ключ (другой браузер,
 * очищенные данные) — сообщения неделю видны снова, и это безопасная сторона.
 */
// Ключ — свой у каждой учётной записи: компьютер в клинике общий, и закрытое
// одним врачом не должно прятать от другого сброс ЕГО пароля.
function seenKey(userId: string): string {
  return `kc.accountNotices.seenUpTo.${userId}`;
}

function readSeen(userId: string): string | null {
  try {
    return window.localStorage.getItem(seenKey(userId));
  } catch {
    return null;
  }
}

function writeSeen(userId: string, value: string): void {
  try {
    window.localStorage.setItem(seenKey(userId), value);
  } catch {
    // Хранилище недоступно (приватное окно) — сообщение просто вернётся.
  }
}

/** Сообщения новее закрытого; сервер отдаёт их от свежих к старым. */
export function unseenNotices(
  notices: readonly AccountNotice[],
  seenUpTo: string | null,
): AccountNotice[] {
  if (seenUpTo === null) return [...notices];
  const seen = Date.parse(seenUpTo);
  return notices.filter((notice) => Date.parse(notice.at) > seen);
}

/**
 * Что администратор сделал с учётной записью (находка Н5 security-прохода).
 *
 * Сброс пароля и второго фактора, смена роли, передача пациентов пишутся в
 * журнал, но врач о журнале не знает — а сброс, которого он не просил, это
 * повод позвонить в клинику сразу. Сервер отдаёт действия за неделю; закрытое
 * здесь не показывается снова, пока не случится новое.
 */
export function AccountNotices({ userId }: { userId: string }) {
  const { t } = useTranslation("auth");
  const [seenUpTo, setSeenUpTo] = useState(() => readSeen(userId));
  const notices = useQuery({
    queryKey: ["me", "account-notices"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AccountNotice[]> => {
      const { data, error } = await api.GET(
        "/api/v1/users/me/account-notices",
        {},
      );
      if (error || !Array.isArray(data)) {
        throw error ?? new Error("Unexpected notices response");
      }
      return data;
    },
  });

  // Ошибка загрузки молчит: сообщение вспомогательное, и экран ошибки над
  // каждым разделом кабинета мешал бы работе больше, чем пропущенное
  // сообщение, которое придёт со следующей загрузкой.
  const visible = unseenNotices(notices.data ?? [], seenUpTo);
  const newest = visible[0];
  if (newest === undefined) return null;

  const dismiss = () => {
    writeSeen(userId, newest.at);
    setSeenUpTo(newest.at);
  };

  return (
    <Alert className="mb-4" role="status">
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>{t("accountNotices.title")}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-5">
          {visible.map((notice) => (
            <li key={`${notice.kind}-${notice.at}`}>
              {t(`accountNotices.kinds.${notice.kind}`, {
                when: formatDayTime(new Date(notice.at)),
                count: notice.count ?? 0,
              })}
            </li>
          ))}
        </ul>
        <p>{t("accountNotices.hint")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={dismiss}
        >
          {t("accountNotices.dismiss")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
