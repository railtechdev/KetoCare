import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type InvitationCreated = components["schemas"]["InvitationCreated"];
export type Invitation = components["schemas"]["InvitationRead"];
export type Role = components["schemas"]["UserRole"];

/** Верхняя граница страницы на сервере (`MAX_PAGE_SIZE`, раздел 5.1 ТЗ). */
const PAGE_LIMIT = 200;

/**
 * Выданные приглашения.
 *
 * Ссылка показывается один раз и не восстанавливается, поэтому вопрос «я уже
 * приглашал эту семью?» оставался без ответа. Сервер сам решает, чьи
 * приглашения показать: администратору все, врачу и диетологу — свои.
 */
export function useInvitations() {
  return useQuery({
    queryKey: ["invitations", "list"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/auth/invitations", {
        params: { query: { limit: PAGE_LIMIT, offset: 0 } },
      });
      if (error || !data)
        throw error ?? new Error("Empty invitations response");
      return data;
    },
  });
}

export function useRevokeInvitationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string): Promise<Invitation> => {
      const { data, error } = await api.POST(
        "/api/v1/auth/invitations/{invitation_id}/revoke",
        { params: { path: { invitation_id: invitationId } } },
      );
      if (error || !data) throw error ?? new Error("Empty revoke response");
      return data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["invitations"] }),
  });
}

/**
 * Выдача приглашения.
 *
 * Кто кого зовёт, решает сервер (ADR-0003): администратор — персонал, врач и
 * диетолог — семьи. Клиент этот выбор не сужает и не расширяет, он только
 * показывает подходящий набор ролей.
 */
export function useCreateInvitationMutation() {
  const queryClient = useQueryClient();

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
    // Выданное приглашение сразу видно в списке: иначе он отвечал бы на вопрос
    // «кого я звал» с задержкой в одно обновление страницы.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["invitations"] }),
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
