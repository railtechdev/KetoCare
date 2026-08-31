import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "../lib/i18n";
import commonRu from "../locales/ru/common.json";
import { NotFoundPage } from "./NotFoundPage";

vi.mock("../features/auth/useSession", () => ({
  useSession: () => ({ session: null }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/login">{children}</a>
  ),
}));

i18n.addResourceBundle("ru", "common", commonRu, true, true);

describe("экран «страница не найдена»", () => {
  it("имеет заголовок страницы", () => {
    // Без h1 для скринридера это страница без имени (правило П24 канона).
    render(<NotFoundPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: commonRu.notFound.title }),
    ).toBeInTheDocument();
  });

  it("даёт выход, а не тупик", () => {
    render(<NotFoundPage />);

    expect(screen.getByRole("link")).toBeInTheDocument();
  });
});
