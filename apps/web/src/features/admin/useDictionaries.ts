import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import {
  MAX_PAGE_SIZE,
  type DictionaryEntryCreateBody,
  type DictionaryEntryUpdateBody,
} from "./types";

/**
 * Справочники, которые правит администратор (раздел 4.2 ТЗ: наполняются
 * миграцией-сидом, дальше правятся из админки).
 */
export const DICTIONARY_KINDS = ["seizure-types", "ketone-methods"] as const;

export type DictionaryKind = (typeof DICTIONARY_KINDS)[number];

/**
 * Ручки разведены по путям, поэтому и вызовы разведены ветками, а не собраны
 * подстановкой в строку пути: путь, склеенный из переменной, не проверяется
 * типами, и опечатка в нём обнаружилась бы только в браузере.
 */
export function useDictionaryEntries(kind: DictionaryKind) {
  return useQuery({
    // Ключ общий с потребителями справочника (форма приступа читает
    // `['dictionaries','seizure-types']`), поэтому правка из админки
    // инвалидирует и их кэш.
    queryKey: ["dictionaries", kind, "entries"],
    queryFn: async () => {
      const params = { query: { limit: MAX_PAGE_SIZE, offset: 0 } };

      const { data, error } =
        kind === "seizure-types"
          ? await api.GET("/api/v1/dictionaries/seizure-types", {
              params,
            })
          : await api.GET("/api/v1/dictionaries/ketone-methods", {
              params,
            });

      if (error || !data) throw error ?? new Error("Empty dictionary response");
      return data;
    },
  });
}

function useDictionaryInvalidation(kind: DictionaryKind) {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: ["dictionaries", kind] });
    // Правка справочника пишется в audit_log (правило 7 CLAUDE.md).
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };
}

export function useCreateDictionaryEntryMutation(kind: DictionaryKind) {
  const invalidate = useDictionaryInvalidation(kind);

  return useMutation({
    mutationFn: async (body: DictionaryEntryCreateBody) => {
      const { data, error } =
        kind === "seizure-types"
          ? await api.POST("/api/v1/admin/dictionaries/seizure-types", { body })
          : await api.POST("/api/v1/admin/dictionaries/ketone-methods", {
              body,
            });

      if (error || !data) throw error ?? new Error("Empty create response");
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Удаление значения справочника.
 *
 * Опечатка в названии типа приступа иначе остаётся в выпадающем списке у всех
 * семей навсегда: переименование ретроспективно меняет смысл уже записанных
 * приступов, а признака «выведено из употребления» у справочника нет.
 *
 * Значение, на которое уже ссылаются дневники, сервер удалить не даёт — и это
 * правильно: физическое удаление здесь настоящее, колонки `deleted_at` у
 * справочников нет.
 */
export function useDeleteDictionaryEntryMutation(kind: DictionaryKind) {
  const invalidate = useDictionaryInvalidation(kind);

  return useMutation({
    mutationFn: async (entryId: string) => {
      const params = { path: { entry_id: entryId } };

      const { error } =
        kind === "seizure-types"
          ? await api.DELETE(
              "/api/v1/admin/dictionaries/seizure-types/{entry_id}",
              { params },
            )
          : await api.DELETE(
              "/api/v1/admin/dictionaries/ketone-methods/{entry_id}",
              { params },
            );

      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateDictionaryEntryMutation(kind: DictionaryKind) {
  const invalidate = useDictionaryInvalidation(kind);

  return useMutation({
    mutationFn: async (input: {
      entryId: string;
      body: DictionaryEntryUpdateBody;
    }) => {
      const params = { path: { entry_id: input.entryId } };

      const { data, error } =
        kind === "seizure-types"
          ? await api.PATCH(
              "/api/v1/admin/dictionaries/seizure-types/{entry_id}",
              { params, body: input.body },
            )
          : await api.PATCH(
              "/api/v1/admin/dictionaries/ketone-methods/{entry_id}",
              { params, body: input.body },
            );

      if (error || !data) throw error ?? new Error("Empty update response");
      return data;
    },
    onSuccess: invalidate,
  });
}
