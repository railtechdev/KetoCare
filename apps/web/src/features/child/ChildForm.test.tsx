import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../lib/i18n";
import { ChildForm } from "./ChildForm";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      GET: vi.fn().mockResolvedValue({ data: { items: [], total: 0 } }),
    },
  };
});

function renderNewCard(onSubmit = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ChildForm
        child={null}
        onSubmit={onSubmit}
        pending={false}
        error={null}
      />
    </QueryClientProvider>,
  );
  return onSubmit;
}

describe("новая карта пациента", () => {
  it("пол не выбран заранее (аудит 12.11.2026)", () => {
    // Умолчание «Мальчик» сохраняло девочек мальчиками, а после создания
    // карты пол не меняется: по нему считается оценка роста по ВОЗ.
    renderNewCard();

    const sex = screen.getByLabelText("Пол") as HTMLSelectElement;
    expect(sex.value).toBe("");
  });

  it("без выбранного пола карта не сохраняется", async () => {
    const onSubmit = renderNewCard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Имя и фамилия"), "Аня Иванова");
    await user.type(screen.getByLabelText("Рост, см"), "118");
    await user.type(screen.getByLabelText("Вес, кг"), "21");
    await user.click(screen.getByRole("button", { name: /завести/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Выберите пол.").length).toBeGreaterThan(0);
  });
});
