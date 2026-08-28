import { useMutation } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type InvitationCreated = components["schemas"]["InvitationCreated"];
export type Role = components["schemas"]["UserRole"];

/**
 * Выдача приглашения.
 *
 * Кто кого зовёт, решает сервер (ADR-0003): администратор — персонал, врач и
 * диетолог — семьи. Клиент этот выбор не сужает и не расширяет, он только
 * показывает подходящий набор ролей.
 */
export function useCreateInvitationMutation() {
  return useMutation({
    mutationFn: async (body: {
      email: string;
      role: Role;
    }): Promise<InvitationCreated> => {
      const { data, error } = await api.POST("/api/v1/auth/invitations", {
        body,
      });
      if (error || !data) throw error ?? new Error("Empty invitation response");
      return data;
    },
  });
}

export function useAcceptInvitationMutation() {
  return useMutation({
    mutationFn: async (body: {
      token: string;
      full_name: string;
      password: string;
      phone?: string | null;
    }) => {
      const { data, error } = await api.POST(
        "/api/v1/auth/invitations/accept",
        {
          body,
        },
      );
      if (error || !data) throw error ?? new Error("Empty accept response");
      return data;
    },
  });
}

/**
 * Ссылка, которую передают приглашённому.
 *
 * Токен возвращается один раз — в базе лежит только его хеш, и повторно ссылку
 * не собрать. Почтового канала в продукте нет (раздел 12 ТЗ не содержит
 * переменных SMTP), доступ выдаётся на приёме, поэтому ссылку показывают, а не
 * обещают письмо.
 */
export function invitationLink(token: string): string {
  return `${window.location.origin}/invite?token=${encodeURIComponent(token)}`;
}
