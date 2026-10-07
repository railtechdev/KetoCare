import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import "../lib/i18n";
import { UserMenu } from "./UserMenu";

vi.mock("../features/auth/useMe", () => ({
  useMe: () => ({ data: { full_name: "Мария Иванова" } }),
}));

vi.mock("../features/auth/useSession", () => ({
  useSession: () => ({ signOut: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

function renderMenu() {
  const client = new QueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <UserMenu session={{ userId: "u1", role: "parent", patientScope: null }} />,
    { wrapper: Wrapper },
  );
}

describe("меню пользователя", () => {
  it("подпись кнопки содержит видимое имя (WCAG 2.5.3)", () => {
    renderMenu();

    expect(
      screen.getByRole("button", { name: /Мария Иванова/ }),
    ).toBeInTheDocument();
  });

  it("тема — группа радиокнопок с отмеченным выбором", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: /Мария Иванова/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: /Оформление/ }),
    );

    const options = await screen.findAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent)).toEqual([
      "Светлое",
      "Тёмное",
      "Как в системе",
    ]);
    expect(
      options.filter(
        (option) => option.getAttribute("aria-checked") === "true",
      ),
    ).toHaveLength(1);
  });
});
