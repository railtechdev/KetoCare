import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import childRu from "../../locales/ru/child.json";
import doctorRu from "../../locales/ru/doctor.json";
import { PatientRouter } from "../../test/PatientRouter";
import { PatientProfileView } from "./PatientProfileView";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      // Раздел тянет и списки (`{items}`), и справочники (массив): ответ
      // выбирается по адресу, иначе один из них падает на разборе.
      GET: vi.fn().mockImplementation((path: string) =>
        Promise.resolve({
          data:
            path.includes("colleagues") ||
            path.includes("attachments") ||
            path.includes("parents") ||
            path.includes("doctors") ||
            path.includes("intake-options") ||
            path.includes("aed-drugs")
              ? []
              : { items: [], total: 0 },
        }),
      ),
      PATCH: vi.fn(),
    },
  };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "u1", role: "doctor" } }),
}));

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);
// Форма профиля — из раздела семьи: без её словаря подписи полей были бы
// ключами, и тест проверял бы не то.
i18n.addResourceBundle("ru", "child", childRu, true, true);

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

function renderProfile(patient: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PatientRouter patientId={PATIENT.id} view="profile">
          {children}
        </PatientRouter>
      </QueryClientProvider>
    );
  }

  return render(
    <PatientProfileView
      patient={{ ...PATIENT, ...patient } as never}
      clinicalAllowed
    />,
    { wrapper: Wrapper },
  );
}

describe("паспорт пациента", () => {
  it("называет аллергии словами, а не идентификаторами продуктов", async () => {
    // Врач читал «dcf7df2c-349b-42f8-bfb4-886ebc6ea111, цитрусовые» ровно в том
    // поле, по которому решает, что ребёнку можно.
    renderProfile();

    expect(
      await screen.findByText(/Кокосовое масло, цитрусовые/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/dcf7df2c/)).not.toBeInTheDocument();
  });

  it("показывает заметки семьи", async () => {
    // Родитель пишет их в разделе «Ребёнок»; читателя у поля не было ни одного.
    renderProfile();

    expect(await screen.findByText(/Плохо переносит жару/)).toBeInTheDocument();
  });

  it("не показывает пустую строку заметок", async () => {
    renderProfile({ notes: "   " });

    await screen.findByText(/Кокосовое масло/);
    expect(screen.queryByText("Заметки семьи")).not.toBeInTheDocument();
  });
});

describe("правка профиля ребёнка специалистом", () => {
  it("рост и аллергии правит и врач, а не только семья", async () => {
    // Ребёнка взвешивают на приёме, а непереносимость всплывает в разговоре с
    // врачом. Сервер это давно разрешал ведущему специалисту — интерфейса не
    // было.
    (api.PATCH as Mock).mockResolvedValue({
      data: { ...PATIENT, height_cm: 106 },
    });
    const user = userEvent.setup();
    renderProfile();

    await user.click(await screen.findByRole("button", { name: "Изменить" }));

    const height = await screen.findByLabelText(/Рост/);
    await user.clear(height);
    await user.type(height, "106");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(api.PATCH).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}",
        expect.objectContaining({
          body: expect.objectContaining({ height_cm: 106 }),
        }),
      );
    });
  });
});

describe("состав раздела", () => {
  it("собирает анамнез в одном месте, а не размазывает по сводке", async () => {
    // Анкета, документы, семья и ведущие специалисты жили внутри «Сводки», и
    // ответ на вопрос «что с ребёнком сейчас» приходилось пролистывать.
    renderProfile();

    for (const title of [
      "Данные пациента",
      "Анкета",
      "Медицинский профиль",
      "Кто ведёт ребёнка дома",
    ]) {
      expect(
        await screen.findByRole("heading", { name: new RegExp(title) }),
      ).toBeInTheDocument();
    }
  });
});
