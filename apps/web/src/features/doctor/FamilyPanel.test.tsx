import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import doctorRu from "../../locales/ru/doctor.json";
import { FamilyPanel } from "./FamilyPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Красный флаг «семья молчит N дней» стоял первой строкой списка, а следующего
 * шага не существовало: ни телефона, ни почты, ни имени того, кто ведёт
 * ребёнка. Триаж заканчивался констатацией проблемы (ADR-0011).
 */
describe("кто ведёт ребёнка дома", () => {
  beforeEach(() => vi.clearAllMocks());

  it("даёт позвонить и написать, а не переписывать номер", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [
        {
          id: "p1",
          full_name: "Мария Иванова",
          phone: "+998901234567",
          email: "maria@example.com",
        },
      ],
      error: undefined,
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    // Врач звонит с того же устройства, на котором смотрит карту.
    expect(
      await screen.findByRole("link", { name: /\+998901234567/ }),
    ).toHaveAttribute("href", "tel:+998901234567");
    expect(
      screen.getByRole("link", { name: /maria@example.com/ }),
    ).toHaveAttribute("href", "mailto:maria@example.com");
  });

  it("без телефона показывает почту, а не прочерк", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [
        { id: "p1", full_name: "Отец", phone: null, email: "dad@example.com" },
      ],
      error: undefined,
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    // Прочерк читался бы как «связаться нельзя», хотя канал есть.
    expect(
      await screen.findByRole("link", { name: /dad@example.com/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^tel:/ }),
    ).not.toBeInTheDocument();
  });

  it("показывает обоих родителей", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [
        { id: "p1", full_name: "Мать", phone: null, email: "m@example.com" },
        { id: "p2", full_name: "Отец", phone: null, email: "f@example.com" },
      ],
      error: undefined,
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    // Связь многие-ко-многим: молчать может один из двоих.
    expect(await screen.findByText("Мать")).toBeInTheDocument();
    expect(screen.getByText("Отец")).toBeInTheDocument();
  });
});
