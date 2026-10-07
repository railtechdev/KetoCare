import { Button, formatOccurredAt, toast } from "@ketocare/ui";
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf, type ApiErrorBody } from "../../lib/api";
import { useFamilyNudge } from "./doctorQueries";
import type { FamilyNudge } from "./types";

/**
 * «Напомнить семье в Telegram» (ADR-0046, аудит блокеров C5).
 *
 * Флаг «семья молчит N дней» заканчивался констатацией: у семьи из Telegram
 * нет ни телефона, ни почты. Кнопка стоит там, где врач видит молчание
 * (строка пациента), и там, где он ищет, как связаться (блок «Семья»).
 *
 * Что именно уйдёт семье, собирает сервер: кто просит и где отметить, без
 * чисел и без имени ребёнка. Исход говорится тостом — их три, и каждый
 * называет следующий шаг: отправлено; Telegram не подключён (тогда контакты,
 * если они есть); уже напоминали (тогда когда).
 */
export function NudgeFamilyButton({
  patientId,
  patientName,
  size = "sm",
}: {
  patientId: string;
  /**
   * Имя ребёнка — для подписи кнопки в строке перечня: там кнопок столько же,
   * сколько молчащих семей, и «Напомнить семье» без имени программа чтения
   * экрана зачитывала одинаково в каждой строке. В карте пациента имя уже
   * в заголовке, и оно не нужно.
   */
  patientName?: string;
  size?: "sm" | "default";
}) {
  const { t } = useTranslation("doctor");
  const nudge = useFamilyNudge(patientId);

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className="min-h-touch"
      disabled={nudge.isPending}
      aria-label={
        patientName === undefined
          ? undefined
          : t("nudge.actionFor", { name: patientName })
      }
      onClick={() =>
        nudge.mutate(undefined, {
          onSuccess: (result) => announce(t, result),
          onError: (error) => {
            const previous = previousNudgeAt(error);
            toast.error(
              previous === null
                ? (errorMessageOf(error) ?? t("common:errors.unexpected"))
                : t("nudge.already", { when: formatOccurredAt(previous) }),
            );
          },
        })
      }
    >
      <BellRing aria-hidden="true" />
      {t("nudge.action")}
    </Button>
  );
}

function announce(
  t: ReturnType<typeof useTranslation<"doctor">>["t"],
  result: FamilyNudge,
): void {
  if (result.recipients > 0) {
    toast.success(t("nudge.sent", { count: result.recipients }));
    return;
  }
  // Отправлять некуда. Контакты — запасной путь; если их нет, остаётся код
  // доступа на приёме, и тост говорит именно это, а не «ошибка».
  const contacts = result.contacts
    .map((contact) =>
      [contact.full_name, contact.phone, contact.email]
        .filter((part): part is string => part !== null && part !== "")
        .join(", "),
    )
    .join("; ");
  toast.warning(t("nudge.noTelegram"), {
    description:
      contacts === ""
        ? t("nudge.noContacts")
        : t("nudge.contacts", { contacts }),
  });
}

/** Время прежней просьбы из отказа 409, если отказ именно об этом. */
function previousNudgeAt(error: unknown): Date | null {
  if (typeof error !== "object" || error === null || !("error" in error)) {
    return null;
  }
  const details = (error as ApiErrorBody).error.details;
  if (details?.reason !== "nudged_recently") return null;
  const value = details.previous_at;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
