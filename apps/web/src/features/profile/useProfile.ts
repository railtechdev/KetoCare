import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type MeUpdateBody = components["schemas"]["MeUpdate"];

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: MeUpdateBody) => {
      const { data, error } = await api.PATCH("/api/v1/users/me", { body });
      if (error || !data) throw error ?? new Error("Empty profile response");
      return data;
    },
    onSuccess: (data) => {
      // Имя из шапки берётся из того же запроса — обновляем его сразу, чтобы
      // пользователь увидел результат там, где смотрел до правки.
      queryClient.setQueryData(["me"], data);
    },
  });
}
