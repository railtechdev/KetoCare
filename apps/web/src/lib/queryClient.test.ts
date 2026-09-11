import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "./queryClient";

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("клиент запросов кабинета", () => {
  it("запись без сети не встаёт на паузу, а уходит и отказывает сразу", async () => {
    // Пауза в памяти вкладки теряла запись при закрытии вкладки и отправляла её
    // молча, когда экрана уже нет (ADR-0034).
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
