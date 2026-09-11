import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import { createQueryClient } from "../../lib/queryClient";
import {
  useSaveDishMutation,
  useScaleMutation,
  useSolveMutation,
} from "./useCalcMutations";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: vi.fn() } };
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

afterEach(() => {
  onlineManager.setOnline(true);
  vi.clearAllMocks();
});

describe("режим сети у мутаций калькулятора (ADR-0034)", () => {
  it("подбор и пересчёт — расчёты: без сети ждут связи, а не отказывают", async () => {
    onlineManager.setOnline(false);
    const solve = renderHook(() => useSolveMutation(), { wrapper });
    const scale = renderHook(() => useScaleMutation(), { wrapper });

    act(() => {
      solve.result.current.mutate({ rows: [], targets: {} } as never);
      scale.result.current.mutate({ rows: [], factor: 2 });
    });

    await waitFor(() => expect(solve.result.current.isPaused).toBe(true));
    await waitFor(() => expect(scale.result.current.isPaused).toBe(true));
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("сохранение блюда — запись: без сети уходит и отказывает сразу", async () => {
    (api.POST as Mock).mockImplementation(() =>
      Promise.reject(new Error("offline")),
    );
    onlineManager.setOnline(false);
    const save = renderHook(() => useSaveDishMutation("child-1"), { wrapper });

    act(() => {
      save.result.current.mutate({
        title: "Суп",
        rows: [],
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      });
    });

    await waitFor(() => expect(save.result.current.isError).toBe(true));
    expect(save.result.current.isPaused).toBe(false);
    // Только запросы сохранения: подбор и пересчёт из соседнего теста,
    // стоявшие на паузе, досылаются, когда сеть там возвращают.
    expect(
      (api.POST as Mock).mock.calls.filter(([path]) =>
        String(path).includes("custom-dishes"),
      ),
    ).toHaveLength(1);
  });
});
