import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import { fetchKind } from "../diary/useDiary";
import { useTrend } from "./useTrend";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

const PATIENT = "11111111-1111-4111-8111-111111111111";

function ketone(id: string, at: string, method: "blood" | "urine") {
  return { id, occurred_at: at, value: 1.5, method, created_by: null };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("записи за период — до конца (аудит 26.11.2026, 2.15)", () => {
  it("дочитывает страницы, пока не набрано столько, сколько всего", async () => {
    const all = Array.from({ length: 250 }, (_, i) =>
      ketone(`k${i}`, "2026-11-20T08:00:00Z", "blood"),
    );
    (api.GET as Mock).mockImplementation(
      (_path: string, init: { params: { query: { offset: number } } }) => {
        const offset = init.params.query.offset;
        return Promise.resolve({
          data: { items: all.slice(offset, offset + 200), total: all.length },
        });
      },
    );

    const entries = await fetchKind(PATIENT, "ketones", {
      from: "2026-11-01T00:00:00Z",
      to: "2026-11-30T23:59:59Z",
    });

    expect(entries).toHaveLength(250);
    expect(api.GET).toHaveBeenCalledTimes(2);
  });
});

describe("кетоны по крови и по моче — не одной линией (2.8)", () => {
  it("на графике — способ последнего замера, другие посчитаны", async () => {
    const items = [
      ketone("a", "2026-11-20T08:00:00Z", "blood"),
      ketone("b", "2026-11-21T08:00:00Z", "urine"),
      ketone("c", "2026-11-22T08:00:00Z", "blood"),
    ];
    (api.GET as Mock).mockResolvedValue({
      data: { items, total: items.length },
    });

    const { result } = renderHook(() => useTrend(PATIENT, "ketones"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.ketoneMethod).toBe("blood");
    expect(result.current.data?.points.map((point) => point.id)).toEqual([
      "a",
      "c",
    ]);
    expect(result.current.data?.otherMethodCount).toBe(1);
  });
});
