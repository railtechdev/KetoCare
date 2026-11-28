import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type AiSettings = components["schemas"]["AiSettingsView"];
export type AiGroupView = components["schemas"]["AiGroupView"];
export type AiGroupName = AiGroupView["group"];
export type AiGroupBody = components["schemas"]["GroupOverrides"];
export type AiProjectBody = components["schemas"]["ProjectOverrides"];
export type AiKeyCheck = components["schemas"]["AiKeyCheck"];
export type AiProviderView = components["schemas"]["AiProviderView"];
export type AiProviderBody = components["schemas"]["ProviderSettings"];
export type AiProviderKind = AiProviderView["kind"];
export type AiModelView = components["schemas"]["AiModelView"];
export type AiModelBody = components["schemas"]["ModelEntry"];
export type AiTaskView = components["schemas"]["AiTaskView"];
export type AiPriceSuggestion = components["schemas"]["AiPriceSuggestion"];

const KEY = ["admin", "ai-settings"] as const;

/** Раздел «Модели и расход»: подключения, каталог моделей, бюджеты (ADR-0080, ADR-0082). */
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

// --- подключения и каталог моделей (ADR-0082) ---------------------------------

export function useCreateAiProvider() {
  return useSettingsMutation(async (body: AiProviderBody) => {
    const { data, error } = await api.POST("/api/v1/admin/ai/providers", {
      body,
    });
    if (error || !data) throw error ?? new Error("Empty AI settings");
    return data;
  });
}

export function useUpdateAiProvider() {
  return useSettingsMutation(
    async (input: { providerId: string; body: AiProviderBody }) => {
      const { data, error } = await api.PUT(
        "/api/v1/admin/ai/providers/{provider_id}",
        {
          params: { path: { provider_id: input.providerId } },
          body: input.body,
        },
      );
      if (error || !data) throw error ?? new Error("Empty AI settings");
      return data;
    },
  );
}

export function useRemoveAiProvider() {
  return useSettingsMutation(async (providerId: string) => {
    const { data, error } = await api.DELETE(
      "/api/v1/admin/ai/providers/{provider_id}",
      { params: { path: { provider_id: providerId } } },
    );
    if (error || !data) throw error ?? new Error("Empty AI settings");
    return data;
  });
}

export function useReplaceAiKey() {
  return useSettingsMutation(
    async (input: { providerId: string; apiKey: string }) => {
      const { data, error } = await api.PUT(
        "/api/v1/admin/ai/providers/{provider_id}/key",
        {
          params: { path: { provider_id: input.providerId } },
          body: { api_key: input.apiKey },
        },
      );
      if (error || !data) throw error ?? new Error("Empty AI settings");
      return data;
    },
  );
}

export function useRemoveAiKey() {
  return useSettingsMutation(async (providerId: string) => {
    const { data, error } = await api.DELETE(
      "/api/v1/admin/ai/providers/{provider_id}/key",
      { params: { path: { provider_id: providerId } } },
    );
    if (error || !data) throw error ?? new Error("Empty AI settings");
    return data;
  });
}

/** Пустой ключ — проверить тот, что действует сейчас. */
export function useCheckAiKey() {
  return useMutation({
    mutationFn: async (input: {
      providerId: string;
      apiKey: string | null;
    }): Promise<AiKeyCheck> => {
      const { data, error } = await api.POST(
        "/api/v1/admin/ai/providers/{provider_id}/check",
        {
          params: { path: { provider_id: input.providerId } },
          body: { api_key: input.apiKey },
        },
      );
      if (error || !data) throw error ?? new Error("Empty key check");
      return data;
    },
  });
}

export function useSaveAiModel() {
  return useSettingsMutation(async (body: AiModelBody) => {
    const { data, error } = await api.PUT("/api/v1/admin/ai/models", { body });
    if (error || !data) throw error ?? new Error("Empty AI settings");
    return data;
  });
}

export function useRemoveAiModel() {
  return useSettingsMutation(async (ref: string) => {
    const { data, error } = await api.DELETE("/api/v1/admin/ai/models", {
      params: { query: { ref } },
    });
    if (error || !data) throw error ?? new Error("Empty AI settings");
    return data;
  });
}

/**
 * Известная публичная цена модели — подсказка для формы, а не то, что будет
 * списано: считают по цене, сохранённой в каталоге.
 */
export function useAiPriceSuggestion() {
  return useMutation({
    mutationFn: async (input: {
      provider: string;
      model: string;
    }): Promise<AiPriceSuggestion> => {
      const { data, error } = await api.GET("/api/v1/admin/ai/models/price", {
        params: { query: input },
      });
      if (error || !data) throw error ?? new Error("Empty price suggestion");
      return data;
    },
  });
}

/**
 * Имя модели по ссылке для строк, где рядом нет цены: своё имя из каталога,
 * иначе сама ссылка. Ссылка вида `ollama/qwen2.5-coder:7b` — служебная запись,
 * а администратор назвал модель словами.
 */
export function modelName(ref: string, models: AiModelView[]): string {
  return models.find((model) => model.ref === ref)?.name ?? ref;
}

/** Как модель названа на экране: своё имя, иначе идентификатор у поставщика. */
export function modelTitle(model: AiModelView): string {
  return model.name ? `${model.name} (${model.ref})` : model.ref;
}

export type AiSpendReport = components["schemas"]["AiSpendReport"];
export type AiSpendPeriod = AiSpendReport["period"];
export type AiBudgetAlert = components["schemas"]["AiBudgetAlert"];

/** Кто сколько потратил (ADR-0081): человек и сумма, без содержания запросов. */
export function useAiSpend(period: AiSpendPeriod) {
  return useQuery({
    queryKey: ["admin", "ai-spend", period],
    queryFn: async (): Promise<AiSpendReport> => {
      const { data, error } = await api.GET("/api/v1/admin/ai/spend", {
        params: { query: { period } },
      });
      if (error || !data) throw error ?? new Error("Empty AI spend report");
      return data;
    },
  });
}

export type AssistantSpeedReport =
  components["schemas"]["AssistantSpeedReport"];
export type AssistantStep = AssistantSpeedReport["steps"][number]["step"];

/**
 * Сколько идёт ответ помощника по шагам (ADR-0094): только длительности — ни
 * вопроса, ни ответа, ни человека.
 */
export function useAssistantSpeed(period: AiSpendPeriod) {
  return useQuery({
    queryKey: ["admin", "assistant-speed", period],
    queryFn: async (): Promise<AssistantSpeedReport> => {
      const { data, error } = await api.GET(
        "/api/v1/admin/ai/assistant-speed",
        { params: { query: { period } } },
      );
      if (error || !data)
        throw error ?? new Error("Empty assistant speed report");
      return data;
    },
  });
}
