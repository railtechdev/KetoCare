import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatLocale } from "@ketocare/ui";

import i18n, { applyLanguage, languageFromTelegram } from "../../lib/i18n";
import { LanguageSwitch } from "./LanguageSwitch";
import { SessionGate } from "./SessionGate";

const launchData = vi.hoisted(() => vi.fn<() => string | null>());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());

vi.mock("../../lib/telegram", () => ({
  launchData,
  webApp: () => null,
  launchDiagnosis: () => ({ telegram: true, launchParams: true, keys: "" }),
}));
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: post, PUT: put } };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  applyLanguage("ru");
});

describe("выбор языка (ADR-0052)", () => {
  it("каждый язык подписан на самом себе, выбранный отмечен", () => {
    render(<LanguageSwitch persist={false} />);

    expect(
      screen.getByRole("group", { name: "Til / Язык" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Русский" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "O‘zbekcha" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("переключает экран, даты и атрибут lang — и сохраняет выбор на сервере", async () => {
    put.mockResolvedValue({ data: { language: "uz" } });
    render(<LanguageSwitch persist />);

    await userEvent.click(screen.getByRole("button", { name: "O‘zbekcha" }));

    expect(i18n.language).toBe("uz");
    expect(formatLocale()).toBe("uz-Latn-UZ");
    expect(document.documentElement.lang).toBe("uz-Latn");
    expect(put).toHaveBeenCalledWith("/api/v1/users/me/language", {
      body: { language: "uz" },
    });
  });

  it("до входа ничего не сохраняет — сохранять некуда", async () => {
    render(<LanguageSwitch persist={false} />);

    await userEvent.click(screen.getByRole("button", { name: "O‘zbekcha" }));

    expect(i18n.language).toBe("uz");
    expect(put).not.toHaveBeenCalled();
  });

  it("экран «не привязан» можно перевести, не войдя", async () => {
    launchData.mockReturnValue("user=...&hash=...");
    post.mockResolvedValue({ error: {}, response: { status: 404 } });

    render(<SessionGate>{() => null}</SessionGate>, { wrapper });
    expect(await screen.findByText(/ещё не привязан/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "O‘zbekcha" }));

    expect(
      await screen.findByText("Bu Telegram hali ulanmagan"),
    ).toBeInTheDocument();
  });

  it("язык с сервера сильнее языка, на котором экран открылся", async () => {
    launchData.mockReturnValue("user=...&hash=...");
    post.mockResolvedValue({
      data: {
        access_token: "a",
        refresh_token: "r",
        patient_id: "11111111-1111-4111-8111-111111111111",
        patient_name: "Amina",
        web_url: "https://app.example",
        has_web_credentials: false,
        language: "uz",
      },
      response: { status: 200 },
    });

    render(<SessionGate>{(s) => <p>{s.patientName}</p>}</SessionGate>, {
      wrapper,
    });

    expect(await screen.findByText("Amina")).toBeInTheDocument();
    expect(i18n.language).toBe("uz");
  });
});

describe("умолчание из Telegram", () => {
  it("узбекский клиент — узбекский, остальные — русский", () => {
    expect(languageFromTelegram("uz")).toBe("uz");
    expect(languageFromTelegram("uz-UZ")).toBe("uz");
    expect(languageFromTelegram("en")).toBe("ru");
    expect(languageFromTelegram(null)).toBe("ru");
  });
});
