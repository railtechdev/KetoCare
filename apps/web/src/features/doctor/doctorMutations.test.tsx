import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import { useCareTeamMutations, useSaveMedicalProfile } from "./doctorMutations";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { PUT: vi.fn(), DELETE: vi.fn() } };
});

function setup() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const keys = () =>
    invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { wrapper, keys };
}

describe("что сбрасывают записи специалиста", () => {
  it("медпрофиль — всю ветку пациента и реестр", async () => {
    // Дата начала терапии из профиля — точка отсчёта сводки и реестра:
    // без сброса карта показывала прежний день терапии.
    (api.PUT as Mock).mockResolvedValue({ data: { therapy_started_on: null } });
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useSaveMedicalProfile("p1"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({} as never);
    });

    expect(keys()).toContainEqual(["patient", "p1"]);
    expect(keys()).toContainEqual(["patients"]);
  });

  it("снятие ведения — реестр и журнал кодов", async () => {
    (api.DELETE as Mock).mockResolvedValue({ error: undefined });
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useCareTeamMutations("p1"), {
      wrapper,
    });

    await act(async () => {
      await result.current.remove.mutateAsync("d1");
    });

    expect(keys()).toContainEqual(["patients"]);
    expect(keys()).toContainEqual(["patient", "p1", "access-codes"]);
  });
});
