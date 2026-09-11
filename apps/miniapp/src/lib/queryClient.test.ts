import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "./queryClient";

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("клиент запросов Mini App", () => {
  it("запись без сети не встаёт на паузу, а уходит и отказывает сразу", async () => {
    // Отметка «съедено» или вопрос помощнику, отложенные в памяти вкладки,
    // пропадали с закрытием Telegram и уходили молча потом (ADR-0034).
    const client = createQueryClient();
    const mutationFn = vi.fn(() => Promise.reject(new Error("offline")));
    onlineManager.setOnline(false);

    const mutation = client.getMutationCache().build(client, { mutationFn });
    await expect(mutation.execute(undefined)).rejects.toThrow("offline");

    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(mutation.state.isPaused).toBe(false);
  });

  it("запросы на чтение настроены как раньше", () => {
    const options = createQueryClient().getDefaultOptions().queries;
    expect(options?.staleTime).toBe(30_000);
    expect(options?.retry).toBe(1);
  });
});
