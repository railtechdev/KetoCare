import { Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { PatientRouter } from "../../test/PatientRouter";
import { PrescriptionView } from "./PrescriptionView";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "u1", role: "doctor" } }),
}));

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const DOCTOR_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const ACTIVE = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  patient_id: PATIENT_ID,
  ratio: 4,
  kcal_per_day: 1200,
  protein_g: 26,
  carbs_limit_g: 10,
  meals_per_day: 4,
  restrictions: null,
  author_id: DOCTOR_ID,
  effective_from: "2026-08-01",
  created_at: "2026-08-01T09:00:00Z",
};

const OLD = {
  ...ACTIVE,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ratio: 3,
  effective_from: "2026-06-01",
  created_at: "2026-06-01T09:00:00Z",
};

const CREATED = {
  ...ACTIVE,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ratio: 3.5,
  effective_from: "2026-08-28",
  created_at: "2026-08-28T10:00:00Z",
};

let history: { items: (typeof ACTIVE)[] };

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {/* Toaster монтируется в `AppLayout`, а тест рендерит раздел отдельно:
            без него сообщение об успехе некуда показать (правило П16). */}
        <PatientRouter patientId={PATIENT_ID} view="prescription">
          {children}
        </PatientRouter>
        <Toaster />
      </QueryClientProvider>
    );
  }

  return render(<PrescriptionView patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  history = { items: [ACTIVE, OLD] };

  (api.GET as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/patients/{patient_id}/prescriptions") {
      return Promise.resolve({
        data: { items: history.items, total: history.items.length },
      });
    }
    // Справочники отдают массив, списки — `{items}`: ответ выбирается по
    // адресу, иначе один из разборов падает.
    return Promise.resolve({
      data:
        path.includes("aed-drugs") || path.includes("intake")
          ? []
          : { items: [], total: 0 },
    });
  });

  (api.POST as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/patients/{patient_id}/prescriptions") {
      history = { items: [CREATED, ...history.items] };
      return Promise.resolve({ data: CREATED });
    }
    throw new Error(`Unexpected POST ${path}`);
  });
});

describe("форма назначения", () => {
  it("не отправляет кетосоотношение вне шага 0,5 и показывает версию после сохранения", async () => {
    // Самая клинически нагруженная форма кабинета: ошибка здесь — это ошибка
    // расчёта у семьи. Шаг проверяет схема, но отправку блокирует форма, и
    // проверяется здесь именно она.
    const user = userEvent.setup();
    renderView();

    // Форма пересоздаётся по ключу, когда приходит действующее назначение
    // (`key={active?.id}` в `PrescriptionTab`), поэтому поле берётся заново
    // после того, как оно подставилось: узел, взятый раньше, к этому моменту
    // уже откреплён от документа.
    const field = () =>
      screen.getByLabelText<HTMLInputElement>("Кетосоотношение");
    await waitFor(() => expect(field().value).toBe("4"));
    const ratio = field();

    // Значение ставится событием, а не набором по знаку: `input type="number"`
    // в jsdom отбрасывает промежуточное «3.» как недопустимое и оставляет поле
    // пустым. Проверяется отказ формы отправить значение вне шага, а не работа
    // браузерного поля.
    fireEvent.change(ratio, { target: { value: "3.7" } });
    await user.click(
      screen.getByRole("button", { name: "Сохранить назначение" }),
    );

    // Текст обязан стоять в двух местах сразу: под полем и строкой сводки над
    // формой (правило П8 канона — сводка повторяет формулировку поля, иначе
    // читается как вторая, несуществующая ошибка).
    const ratioErrors = await screen.findAllByText(
      "Кетосоотношение — от 1,0 до 5,0 с шагом 0,5.",
    );
    expect(ratioErrors).toHaveLength(2);

    // Строка сводки ведёт в поле: без якоря она сообщает об ошибке, но не
    // помогает её исправить.
    const summaryLink = ratioErrors.find(
      (node) => node.tagName === "A",
    ) as HTMLAnchorElement;
    expect(summaryLink).toBeDefined();
    expect(summaryLink.getAttribute("href")).toBe(`#${ratio.id}`);
    expect(api.POST).not.toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/prescriptions",
      expect.anything(),
    );

    fireEvent.change(ratio, { target: { value: "3.5" } });
    await user.click(
      screen.getByRole("button", { name: "Сохранить назначение" }),
    );

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/prescriptions",
      expect.objectContaining({
        params: { path: { patient_id: PATIENT_ID } },
        body: expect.objectContaining({
          ratio: 3.5,
          kcal_per_day: 1200,
          protein_g: 26,
          carbs_limit_g: 10,
          meals_per_day: 4,
          restrictions: null,
        }),
      }),
    );

    // Номер версии берётся из обновлённой истории, а не из «было плюс один»,
    // и сообщается тостом, а не зелёной строкой в потоке страницы.
    expect(await screen.findByText("Создана версия 3")).toBeInTheDocument();
  });

  it("держит диету и схему препаратов в одном разделе", async () => {
    // Разносить их значило бы требовать переход между двумя половинами одного
    // решения: и то и другое — то, что назначил врач.
    renderView();

    expect(
      await screen.findByRole("heading", {
        name: /Схема лекарственной терапии/,
      }),
    ).toBeInTheDocument();
  });
});
