import { useMutation } from "@tanstack/react-query";

import { api, setTokens } from "../../lib/api";
import { launchData } from "../../lib/telegram";

export interface Session {
  patientId: string;
  patientName: string;
}

/** Почему приложение не открылось. Каждое состояние ведёт к своему экрану. */
export type SessionProblem =
  /** Открыто не из Telegram: строки запуска нет. */
  | "outside_telegram"
  /** Telegram есть, привязки нет — нужен код из кабинета. */
  | "not_linked"
  /** Подпись не сошлась или сервер недоступен. */
  | "failed";

/**
 * Обмен строки запуска на сессию (раздел 5.2 ТЗ, ADR-0017).
 *
 * Пароль не спрашивается: личность подтверждает Telegram подписью, а право на
 * ребёнка — привязка чата, заведённая в кабинете. Поэтому «не привязан» — это
 * не отказ, а состояние с понятным продолжением, и оно отделено от ошибки.
 */
export function useOpenSession() {
  return useMutation<Session, SessionProblem>({
    mutationFn: async () => {
      const initData = launchData();
      if (initData === null) throw "outside_telegram" satisfies SessionProblem;

      const { data, error, response } = await api.POST(
        "/api/v1/auth/telegram-init",
        {
          body: { init_data: initData },
        },
      );

      if (error !== undefined || data === undefined) {
        // 404 — привязки нет. Отличается от прочих отказов тем, что семья
        // может это исправить сама, и приложение должно сказать как.
        throw (
          response.status === 404 ? "not_linked" : "failed"
        ) satisfies SessionProblem;
      }

      setTokens({ access: data.access_token, refresh: data.refresh_token });
      return { patientId: data.patient_id, patientName: data.patient_name };
    },
  });
}
