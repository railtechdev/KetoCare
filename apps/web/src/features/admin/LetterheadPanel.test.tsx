import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import type { Letterhead } from "../letterhead/useLetterhead";
import { LetterheadPanel } from "./LetterheadPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), PUT: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const EMPTY: Letterhead = {
  text: null,
  logo: null,
  fallback_name: "KetoCare",
  updated_at: null,
};

const TEXT = {
  name_uz: "«Namuna» bolalar nevrologiya markazi",
  name_ru: "Детский неврологический центр «Образец»",
  short_name: "ДНЦ «Образец»",
  department: null,
  address: "г. Ташкент, ул. Образцовая, 1",
  family_phone: null,
  contact: null,
  license: "№ 00000 от 01.02.2023",
  stir: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
  globalThis.URL.createObjectURL = vi.fn(() => "blob:logo");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("LetterheadPanel", () => {
  it("shows the product name in the preview until the letterhead is set", async () => {
    serve(EMPTY);
    render(<LetterheadPanel />, { wrapper });

    const preview = await screen.findByRole("complementary", {
      name: "Как выйдет на листе",
    });
    expect(preview).toHaveTextContent("KetoCare");
  });

  it("previews what is typed and saves blanks as not set", async () => {
    serve(EMPTY);
    (api.PUT as Mock).mockResolvedValue({
      data: { ...EMPTY, text: TEXT, updated_at: "2026-11-19T10:00:00Z" },
    });
    const user = userEvent.setup();
    render(<LetterheadPanel />, { wrapper });

    await user.type(
      await screen.findByLabelText("Полное название на узбекском"),
      TEXT.name_uz,
    );
    await user.type(screen.getByLabelText(/Короткое название/), "ДНЦ");
    expect(
      screen.getByRole("complementary", { name: "Как выйдет на листе" }),
    ).toHaveTextContent(TEXT.name_uz);

    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    const [path, options] = (api.PUT as Mock).mock.calls[0]!;
    expect(path).toBe("/api/v1/admin/letterhead");
    expect(options.body).toMatchObject({
      name_uz: TEXT.name_uz,
      short_name: "ДНЦ",
      name_ru: null,
      stir: null,
    });
  });

  it("does not save without the Uzbek name", async () => {
    serve(EMPTY);
    const user = userEvent.setup();
    render(<LetterheadPanel />, { wrapper });

    await user.type(await screen.findByLabelText(/Короткое название/), "ДНЦ");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      await screen.findAllByText(
        "Укажите полное название на узбекском — до 255 знаков",
      ),
    ).not.toHaveLength(0);
    expect(api.PUT).not.toHaveBeenCalled();
  });

  it("explains a refused logo in the server's words (the check is the server's)", async () => {
    serve({ ...EMPTY, text: TEXT });
    (api.PUT as Mock).mockResolvedValue({
      error: {
        error: {
          code: "validation_error",
          message:
            "Нужен файл PNG. Другие форматы, в том числе SVG, не принимаются.",
          details: {},
        },
      },
    });
    const user = userEvent.setup();
    render(<LetterheadPanel />, { wrapper });

    await user.upload(
      await screen.findByLabelText("Выбрать файл логотипа"),
      new File(["not a png"], "logo.png", { type: "image/png" }),
    );

    expect(await screen.findByText(/Нужен файл PNG/)).toBeInTheDocument();
    expect((api.PUT as Mock).mock.calls[0]![0]).toBe(
      "/api/v1/admin/letterhead/logo",
    );
  });

  it("shows the stored logo in colour and in grey", async () => {
    serve({
      ...EMPTY,
      text: TEXT,
      logo: {
        width: 400,
        height: 200,
        size: 1024,
        sha256: "abc",
        updated_at: "2026-11-19T10:00:00Z",
      },
    });
    render(<LetterheadPanel />, { wrapper });

    expect(await screen.findByAltText("Логотип клиники")).toHaveAttribute(
      "src",
      "blob:logo",
    );
    expect(
      screen.getByAltText("Логотип клиники в оттенках серого"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Заменить логотип")).toBeInTheDocument();
  });
});
