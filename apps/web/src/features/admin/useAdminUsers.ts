import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { MAX_PAGE_SIZE, type AdminUserUpdate } from "./types";

/**
 * Учётные записи (раздел 5.3 ТЗ, `/admin/users`).
 *
 * Клинических данных в этих ответах нет и быть не может: администратор к ним
 * доступа не имеет, ручка отдаёт только профиль учётной записи.
 */
export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/admin/users", {
        params: { query: { limit: MAX_PAGE_SIZE, offset: 0 } },
      });
      if (error || !data) throw error ?? new Error("Empty users response");
      return data;
    },
  });
}

export function useUpdateUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { userId: string; changes: AdminUserUpdate }) => {
      const { data, error } = await api.PATCH("/api/v1/admin/users/{user_id}", {
        params: { path: { user_id: input.userId } },
        body: input.changes,
      });
      if (error || !data)
        throw error ?? new Error("Empty user update response");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      // Правка учётной записи пишется в audit_log (правило 7 CLAUDE.md),
      // поэтому открытый журнал устаревает тем же запросом.
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

/**
 * Сброс второго фактора — последняя ступень восстановления доступа.
 *
 * Первая — резервные коды, выданные при включении 2FA. Когда и они потеряны
 * вместе с телефоном, вернуть человека в систему может только администратор.
 * Отключением второго фактора это не является: при следующем входе учётная
 * запись проходит его настройку заново.
 */
export function useResetTotpMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await api.POST(
        "/api/v1/admin/users/{user_id}/reset-totp",
        { params: { path: { user_id: userId } } },
      );
      if (error || !data) throw error ?? new Error("Empty reset response");
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      // Сброс пишется в журнал — свежая страница журнала обязана его показать.
      await queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

/**
 * Выдать временный пароль.
 *
 * Восстановления пароля в продукте нет: рассылки нет вовсе, а смена требует
 * знать текущий. Забывший пароль врач терял доступ к данным своих пациентов
 * навсегда.
 *
 * Пароль возвращается один раз — в базе только argon2-хэш.
 */
export function useResetPasswordMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await api.POST(
        "/api/v1/admin/users/{user_id}/reset-password",
        { params: { path: { user_id: userId } } },
      );
      if (error || !data) throw error ?? new Error("Empty reset response");
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
