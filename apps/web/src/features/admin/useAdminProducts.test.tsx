import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import { useUpdateProductMutation } from "./useAdminProducts";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { PUT: vi.fn(), PATCH: vi.fn() } };
});

describe("правка продукта", () => {
  it("сбрасывает список аномалий и счётчики главной", async () => {
    // Исправленная позиция оставалась в «аномалиях» до перезагрузки, и
    // администратор правил её второй раз.
    (api.PUT as Mock).mockResolvedValue({ data: { id: "p1" } });
    (api.PATCH as Mock).mockResolvedValue({ data: { id: "p1" } });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateProductMutation("p1"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({} as never);
    });

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(["admin", "product-anomalies"]);
    expect(keys).toContainEqual(["admin", "overview"]);
  });
});
