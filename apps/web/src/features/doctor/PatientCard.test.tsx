import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { SectionRouter } from "../../test/SectionRouter";
import { PatientCard } from "./PatientCard";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn().mockResolvedValue({ data: [] }) } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "u1", role: "doctor" } }),
}));

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Аня Иванова",
  birth_date: "2019-04-12",
  sex: "f",
  height_cm: 104,
  // Как хранит сервер: идентификаторы продуктов вперемешку со свободными метками.
  allergies: ["dcf7df2c-349b-42f8-bfb4-886ebc6ea111", "цитрусовые"],
  excluded_products: [
    {
      product_id: "dcf7df2c-349b-42f8-bfb4-886ebc6ea111",
      name_ru: "Кокосовое масло",
    },
  ],
  allergy_labels: ["цитрусовые"],
  notes: "Плохо переносит жару, кормить дробно.",
  created_at: "2026-08-01T10:00:00Z",
};

function renderCard(patient: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter>{children}</SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <PatientCard
      patient={{ ...PATIENT, ...patient } as never}
      onBack={() => undefined}
    />,
    { wrapper: Wrapper },
  );
}

describe("паспорт пациента в карте врача", () => {
  it("называет аллергии словами, а не идентификаторами продуктов", async () => {
    // Врач читал «dcf7df2c-349b-42f8-bfb4-886ebc6ea111, цитрусовые» ровно в том
    // поле, по которому решает, что ребёнку можно.
    renderCard();

    expect(
      await screen.findByText(/Кокосовое масло, цитрусовые/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/dcf7df2c/)).not.toBeInTheDocument();
  });

  it("показывает заметки семьи", async () => {
    // Родитель пишет их в разделе «Ребёнок»; читателя у поля не было ни одного.
    renderCard();

    expect(await screen.findByText(/Плохо переносит жару/)).toBeInTheDocument();
  });

  it("не показывает пустую строку заметок", async () => {
    renderCard({ notes: "   " });

    await screen.findByText(/Кокосовое масло/);
    expect(screen.queryByText("Заметки семьи")).not.toBeInTheDocument();
  });
});
