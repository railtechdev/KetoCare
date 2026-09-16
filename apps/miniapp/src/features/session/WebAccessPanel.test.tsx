import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import "../../lib/i18n";
import type { Session } from "./useSession";
import { WebAccessPanel } from "./WebAccessPanel";

const post = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: post } };
});

const session: Session = {
  patientId: "11111111-1111-1111-1111-111111111111",
  patientName: "Амина",
  webUrl: "https://ketocare.example",
  hasWebCredentials: false,
};

function renderPanel(value: Session = session) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<WebAccessPanel session={value} />, { wrapper: Wrapper });
}

describe("вход в кабинет из Mini App", () => {
  it("не предлагается тому, у кого кабинет уже есть", () => {
    // Признак приходит с сервера: экран, решающий сам, однажды предложил бы
    // то, что кончится отказом 409.
    renderPanel({ ...session, hasWebCredentials: true });

    expect(screen.queryByText("Вход в кабинет")).not.toBeInTheDocument();
  });

  it("задаёт почту и пароль и исчезает", async () => {
    post.mockResolvedValue({ data: { email: "aigul@example.com" } });
    renderPanel();

    await userEvent.type(screen.getByLabelText("Почта"), "aigul@example.com");
    await userEvent.type(
      screen.getByLabelText(/Пароль/),
      "очень-длинный-пароль",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Включить кабинет" }),
    );

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/api/v1/users/me/credentials", {
        body: {
          email: "aigul@example.com",
          password: "очень-длинный-пароль",
        },
      });
    });
    // Предлагать сделанное — врать: блок уходит сразу, не дожидаясь
    // переоткрытия приложения.
    await waitFor(() => {
      expect(screen.queryByText("Вход в кабинет")).not.toBeInTheDocument();
    });
  });

  it("называет адрес кабинета, а не отправляет искать его", () => {
    renderPanel();

    const link = screen.getByRole("link", { name: "https://ketocare.example" });
    expect(link).toHaveAttribute("href", "https://ketocare.example");
  });

  it("отказ сервера остаётся на экране, а поля — заполненными", async () => {
    post.mockResolvedValue({
      error: { error: { code: "conflict", message: "Эта почта уже занята." } },
    });
    renderPanel();

    await userEvent.type(screen.getByLabelText("Почта"), "taken@example.com");
    await userEvent.type(
      screen.getByLabelText(/Пароль/),
      "очень-длинный-пароль",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Включить кабинет" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Эта почта уже занята.",
    );
    expect(screen.getByLabelText("Почта")).toHaveValue("taken@example.com");
  });
});
