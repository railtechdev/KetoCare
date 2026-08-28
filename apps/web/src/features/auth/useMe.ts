import { useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type Me = components["schemas"]["UserRead"];

/**
 * Профиль текущего пользователя.
 *
 * Имени в токене нет — там только идентификатор и роль, — поэтому шапка не
 * могла показать даже, под кем открыт кабинет. Ключ `['me']` очищается вместе с
 * сессией, как и остальной кэш.
 */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Me> => {
      const { data, error } = await api.GET("/api/v1/users/me", {});
      if (error || !data) throw error ?? new Error("Empty profile response");
      return data;
    },
  });
}
