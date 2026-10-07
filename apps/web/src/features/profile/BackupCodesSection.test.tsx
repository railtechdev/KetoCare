import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import authRu from "../../locales/ru/auth.json";
import { BackupCodesSection } from "./BackupCodesSection";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "auth", authRu, true, true);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("резервные коды в профиле", () => {
  beforeEach(() => vi.clearAllMocks());

  it("без второго фактора блока нет", async () => {
    // Родитель второго фактора не настраивает: «осталось 0 из 10» и
    // перевыпуск, кончающийся отказом, были тупиком.
    (api.GET as Mock).mockResolvedValue({
      data: { remaining: 0, total: 10, enrolled: false },
    });
    const { container } = render(<BackupCodesSection />, { wrapper });

    await vi.waitFor(() => expect(api.GET).toHaveBeenCalled());
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("со вторым фактором показывает остаток", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: { remaining: 7, total: 10, enrolled: true },
    });
    render(<BackupCodesSection />, { wrapper });

    expect(
      await screen.findByText(authRu.backupCodes.sectionTitle),
    ).toBeInTheDocument();
    expect(await screen.findByText(/7/)).toBeInTheDocument();
  });
});
