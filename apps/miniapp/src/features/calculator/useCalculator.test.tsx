import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { createQueryClient } from "../../lib/queryClient";
import { useScale, useSolve } from "./useCalculator";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
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

describe("режим сети у расчётов Mini App (ADR-0034)", () => {
  it("подбор и пересчёт без сети ждут связи, а не отказывают", async () => {
    onlineManager.setOnline(false);
    const solve = renderHook(() => useSolve("child-1"), { wrapper });
    const scale = renderHook(() => useScale(), { wrapper });

    act(() => {
      solve.result.current.mutate({
        rows: [],
        targets: { ratio: 4, kcal: 300 },
      });
      scale.result.current.mutate({ rows: [], factor: 2 });
    });

    await waitFor(() => expect(solve.result.current.isPaused).toBe(true));
    await waitFor(() => expect(scale.result.current.isPaused).toBe(true));
    expect(api.POST).not.toHaveBeenCalled();
  });
});
