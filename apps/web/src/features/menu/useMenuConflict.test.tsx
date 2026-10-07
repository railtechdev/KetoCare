import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import { createQueryClient } from "../../lib/queryClient";
import { menuKey, useCopyDayMutation, useUpsertMenuMutation } from "./useMenu";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), PUT: vi.fn() } };
});

const PATIENT = "11111111-1111-4111-8111-111111111111";
const DAY = "2026-10-07";

const CONFLICT = {
  error: {
    error: {
      code: "conflict",
      message: "В новом плане нет блюда, которое уже отмечено съеденным",
      details: { reason: "drops_eaten_items", eaten: 1 },
    },
  },
  response: { status: 409 },
};

function setup() {
  const client = createQueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { invalidate, wrapper };
}

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * 409 при сохранении дня — день на сервере уже не тот, что на экране (Н10):
 * семья в ту же минуту отметила съеденным блюдо, которого в новом составе нет.
 * Экран обязан перечитать день, иначе специалист не увидит отметку, из-за
 * которой ему отказали, и следующая правка соберётся из устаревшего состава.
 */
describe("отказ 409 при сохранении дня (Н10)", () => {
  it("сохранение перечитывает день", async () => {
    (api.PUT as Mock).mockResolvedValue(CONFLICT);
    const { invalidate, wrapper } = setup();
    const upsert = renderHook(() => useUpsertMenuMutation(PATIENT), {
      wrapper,
    });

    act(() => {
      upsert.result.current.mutate({ date: DAY, items: [] });
    });

    await waitFor(() => expect(upsert.result.current.isError).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: menuKey(PATIENT, DAY),
    });
  });

  it("копирование дня перечитывает день, в который копировали", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: {
        items: [
          {
            meal_index: 1,
            recipe_id: "r1",
            custom_dish_id: null,
            portion_factor: 1,
          },
        ],
      },
      response: { status: 200 },
    });
    (api.PUT as Mock).mockResolvedValue(CONFLICT);
    const { invalidate, wrapper } = setup();
    const copy = renderHook(() => useCopyDayMutation(PATIENT), { wrapper });

    act(() => {
      copy.result.current.mutate({ from: "2026-10-06", to: DAY });
    });

    await waitFor(() => expect(copy.result.current.isError).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: menuKey(PATIENT, DAY),
    });
  });

  it("другой отказ день не перечитывает", async () => {
    (api.PUT as Mock).mockResolvedValue({
      error: { error: { code: "validation_error", message: "Нет позиций" } },
      response: { status: 422 },
    });
    const { invalidate, wrapper } = setup();
    const upsert = renderHook(() => useUpsertMenuMutation(PATIENT), {
      wrapper,
    });

    act(() => {
      upsert.result.current.mutate({ date: DAY, items: [] });
    });

    await waitFor(() => expect(upsert.result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
