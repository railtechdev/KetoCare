import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type Letterhead = components["schemas"]["LetterheadRead"];
export type LetterheadText = components["schemas"]["LetterheadText"];

const KEY = ["letterhead"] as const;

/**
 * Бланк клиники (ADR-0092): название, реквизиты и сведения о логотипе.
 * Читают все роли — документы собирают и семья, и специалист.
 */
export function useLetterhead() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Letterhead> => {
      const { data, error } = await api.GET("/api/v1/letterhead");
      if (error || !data) throw error ?? new Error("Empty letterhead");
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Адрес логотипа для `<img>`. Картинка берётся запросом с токеном и отдаётся
 * как `blob:` — сессия живёт в памяти вкладки, и голый `src` пришёл бы без
 * авторизации. Ключ — отпечаток файла: новый логотип не прячется за кэшем.
 */
export function useLetterheadLogoUrl(
  sha256: string | undefined,
): string | undefined {
  const logo = useQuery({
    queryKey: [...KEY, "logo", sha256],
    enabled: sha256 !== undefined,
    staleTime: Infinity,
    queryFn: async (): Promise<Blob> => {
      const { data, error } = await api.GET("/api/v1/letterhead/logo", {
        parseAs: "blob",
      });
      if (error || !data) throw error ?? new Error("Empty logo");
      return data as Blob;
    },
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!logo.data) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(logo.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [logo.data]);
  return url;
}

function useLetterheadMutation<Input>(
  request: (input: Input) => Promise<Letterhead>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (letterhead) => queryClient.setQueryData(KEY, letterhead),
  });
}

export function useSaveLetterhead() {
  return useLetterheadMutation(async (body: LetterheadText) => {
    const { data, error } = await api.PUT("/api/v1/admin/letterhead", { body });
    if (error || !data) throw error ?? new Error("Empty letterhead");
    return data;
  });
}

export function useUploadLogo() {
  return useLetterheadMutation(async (file: File) => {
    const { data, error } = await api.PUT("/api/v1/admin/letterhead/logo", {
      // Поле файла описано в OpenAPI строкой (binary): по сети уходит
      // multipart/form-data, который собирает bodySerializer.
      body: { file: file as unknown as string },
      bodySerializer: () => {
        const form = new FormData();
        form.append("file", file);
        return form;
      },
    });
    if (error || !data) throw error ?? new Error("Empty letterhead");
    return data;
  });
}

export function useRemoveLogo() {
  return useLetterheadMutation(async () => {
    const { data, error } = await api.DELETE("/api/v1/admin/letterhead/logo");
    if (error || !data) throw error ?? new Error("Empty letterhead");
    return data;
  });
}
