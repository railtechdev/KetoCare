import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type AiSettings = components["schemas"]["AiSettingsView"];
export type AiGroupView = components["schemas"]["AiGroupView"];
export type AiGroupName = AiGroupView["group"];
export type AiGroupBody = components["schemas"]["GroupOverrides"];
export type AiProjectBody = components["schemas"]["ProjectOverrides"];
export type AiKeyCheck = components["schemas"]["AiKeyCheck"];

const KEY = ["admin", "ai-settings"] as const;

/** Раздел «ИИ» администратора (ADR-0080): ключ, модели, бюджеты и расход. */
export function useAiSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AiSettings> => {
      const { data, error } = await api.GET("/api/v1/admin/ai");
      if (error || !data) throw error ?? new Error("Empty AI settings");
      return data;
    },
  });
}

/** Ответ каждой правки — раздел целиком: он и становится состоянием экрана. */
function useSettingsMutation<Input>(
  request: (input: Input) => Promise<AiSettings>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (settings) => queryClient.setQueryData(KEY, settings),
  });
}

export function useSaveAiGroup() {
  return useSettingsMutation(
    async (input: { group: AiGroupName; body: AiGroupBody }) => {
      const { data, error } = await api.PUT("/api/v1/admin/ai/groups/{group}", {
        params: { path: { group: input.group } },
        body: input.body,
      });
      if (error || !data) throw error ?? new Error("Empty AI settings");
      return data;
    },
  );
}

export function useSaveAiProject() {
  return useSettingsMutation(async (body: AiProjectBody) => {
    const { data, error } = await api.PUT("/api/v1/admin/ai/project", { body });
    if (error || !data) throw error ?? new Error("Empty AI settings");
    return data;
  });
}

export function useReplaceAiKey() {
  return useSettingsMutation(async (apiKey: string) => {
    const { data, error } = await api.PUT("/api/v1/admin/ai/key", {
      body: { api_key: apiKey },
    });
    if (error || !data) throw error ?? new Error("Empty AI settings");
    return data;
  });
}

export function useRemoveAiKey() {
  return useSettingsMutation(async () => {
    const { data, error } = await api.DELETE("/api/v1/admin/ai/key");
    if (error || !data) throw error ?? new Error("Empty AI settings");
    return data;
  });
}

/** Пустой ключ — проверить тот, что действует сейчас. */
export function useCheckAiKey() {
  return useMutation({
    mutationFn: async (apiKey: string | null): Promise<AiKeyCheck> => {
      const { data, error } = await api.POST("/api/v1/admin/ai/key/check", {
        body: { api_key: apiKey },
      });
      if (error || !data) throw error ?? new Error("Empty key check");
      return data;
    },
  });
}
