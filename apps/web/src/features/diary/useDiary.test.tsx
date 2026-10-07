import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import { useDiaryMutations } from "./useDiary";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } };
});

describe("запись дневника", () => {
  it("сбрасывает и записи вида, и сводку ребёнка", async () => {
    // Сводка (`/overview`) считается из тех же записей: без сброса главная
    // семьи и карта у врача показывали прежний кетон до истечения кэша.
    (api.POST as Mock).mockResolvedValue({ data: {} });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDiaryMutations("p1", "ketones"), {
      wrapper,
    });

    await act(async () => {
      await result.current.create.mutateAsync({
        kind: "ketones",
        body: {
          occurred_at: "2026-10-07T08:00:00Z",
          value: 2.1,
          method: "blood",
        },
      } as never);
    });

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(["patient", "p1", "logs", "ketones"]);
    expect(keys).toContainEqual(["patient", "p1", "overview"]);
  });
});
