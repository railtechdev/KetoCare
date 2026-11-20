import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import { useClinicBrand } from "./useClinicBrand";
import type { Letterhead } from "./useLetterhead";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

const EMPTY: Letterhead = {
  text: null,
  logo: null,
  fallback_name: "KetoCare",
  updated_at: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function serve(letterhead: Letterhead) {
  (api.GET as Mock).mockImplementation(async (path: string) =>
    path === "/api/v1/letterhead"
      ? { data: letterhead }
      : { data: new Blob(["png"], { type: "image/png" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.title = "KetoCare";
  globalThis.URL.createObjectURL = vi.fn(() => "blob:logo");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("clinic brand in the shell (ADR-0092)", () => {
  it("shows the clinic's short name and logo once the admin set them", async () => {
    serve({
      ...EMPTY,
      text: {
        name_uz: "«Namuna» markazi",
        name_ru: null,
        short_name: "ДНЦ «Образец»",
        department: null,
        address: null,
        family_phone: null,
        contact: null,
        license: null,
        stir: null,
      },
      logo: {
        width: 400,
        height: 200,
        size: 1024,
        sha256: "abc",
        updated_at: "2026-11-19T10:00:00Z",
      },
    });
    const { result } = renderHook(() => useClinicBrand(), { wrapper });

    expect(result.current.name).toBeUndefined();
    await waitFor(() => expect(result.current.logoUrl).toBe("blob:logo"));
    expect(result.current.name).toBe("ДНЦ «Образец»");
    expect(result.current.noLogo).toBe(false);
    expect(document.title).toBe("ДНЦ «Образец»");
  });

  it("falls back to the product while the letterhead is empty", async () => {
    serve(EMPTY);
    const { result } = renderHook(() => useClinicBrand(), { wrapper });

    await waitFor(() => expect(result.current.name).toBe("KetoCare"));
    expect(result.current.noLogo).toBe(true);
    expect(result.current.logoUrl).toBeUndefined();
  });
});
