import { useMutation } from "@tanstack/react-query";

import { api } from "../../lib/api";

/**
 * Мутации аутентификации через TanStack Query (раздел 8.4 ТЗ).
 *
 * Состояние запроса (идёт / ошибка / повтор) ведёт Query, а не ручные
 * useState + useEffect: иначе каждый экран заново изобретает обработку гонок и
 * отменённых запросов.
 */
export function useLoginMutation() {
  return useMutation({
    mutationFn: async (input: {
      email: string;
      password: string;
      totpCode?: string;
      backupCode?: string;
    }) => {
      const { data, error } = await api.POST("/api/v1/auth/login", {
        body: {
          email: input.email,
          password: input.password,
          totp_code: input.totpCode?.trim() ? input.totpCode.trim() : null,
          // Резервный код — на случай, когда телефона с приложением нет.
          // Отправляются оба поля: сервер сам решает, чем открывать вход.
          backup_code: input.backupCode?.trim()
            ? input.backupCode.trim()
            : null,
        },
      });
      if (error || !data) throw error ?? new Error("Empty login response");
      return data;
    },
  });
}

export function useTotpSetupMutation(setupToken: string) {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/auth/totp/setup", {
        body: {},
        headers: { Authorization: `Bearer ${setupToken}` },
      });
      if (error || !data) throw error ?? new Error("Empty setup response");
      return data;
    },
  });
}

export function useTotpVerifyMutation(setupToken: string) {
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await api.POST("/api/v1/auth/totp/verify", {
        body: { code },
        headers: { Authorization: `Bearer ${setupToken}` },
      });
      if (error || !data) throw error ?? new Error("Empty verify response");
      return data;
    },
  });
}
