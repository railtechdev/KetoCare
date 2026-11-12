import { formatGrams, formatKcal, Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { PatientRouter } from "../../test/PatientRouter";
import { currentAddress } from "../../test/address";
import { PrescriptionView } from "./PrescriptionView";
import { nativeSelect } from "../../test/nativeSelect";

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
    if (path === "/api/v1/calc/prescription-goal") {
      return Promise.resolve({ data: undefined });
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
    const field = () => nativeSelect(screen.getByLabelText("Кетосоотношение"));
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
    // Сводка ведёт на кнопку списка, а не на скрытый системный список.
    expect(summaryLink.getAttribute("href")).toBe(
      `#${screen.getByLabelText("Кетосоотношение").id}`,
    );
    expect(api.POST).not.toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/prescriptions",
      expect.anything(),
    );

    fireEvent.change(ratio, { target: { value: "3.5" } });
    await user.click(
      screen.getByRole("button", { name: "Сохранить назначение" }),
    );

    // Ответ клиники на вопрос 5: сохранение открывает окно подтверждения, и
    // до него ничего не отправлено.
    expect(api.POST).not.toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/prescriptions",
      expect.anything(),
    );
    await user.click(
      await screen.findByRole("button", { name: "Подтвердить назначение" }),
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
    expect(await screen.findByText("Назначение сохранено")).toBeInTheDocument();
  });

  it("перед записью показывает значения и прежние рядом с изменёнными, а отмена ничего не пишет", async () => {
    // Ответ клиники на вопрос 5: «после назначения врача можно сделать окно:
    // подтвердите подпись или назначение». Назначение append-only — отменить
    // записанное можно только новой версией, поэтому проверка до записи.
    const user = userEvent.setup();
    renderView();

    const field = () => nativeSelect(screen.getByLabelText("Кетосоотношение"));
    await waitFor(() => expect(field().value).toBe("4"));
    fireEvent.change(field(), { target: { value: "3.5" } });
    await user.click(
      screen.getByRole("button", { name: "Сохранить назначение" }),
    );

    const dialog = await screen.findByRole("alertdialog", {
      name: "Подтвердить изменение назначения?",
    });
    const summary = within(dialog).getByLabelText("Значения назначения");
    // Изменённое — с прежним значением рядом, неизменённое — одно.
    expect(within(summary).getByText("3.5 : 1")).toBeInTheDocument();
    expect(within(summary).getByText("(было 4.0 : 1)")).toBeInTheDocument();
    expect(within(summary).getByText("1 200 ккал")).toBeInTheDocument();
    expect(within(summary).queryByText(/было 1 200/)).not.toBeInTheDocument();
    expect(within(summary).getByText("26 г")).toBeInTheDocument();
    expect(within(summary).getByText("10 г")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Вернуться к форме" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(api.POST).not.toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/prescriptions",
      expect.anything(),
    );
    // Форма осталась с введённым — врач правит дальше, а не набирает заново.
    expect(field().value).toBe("3.5");
  });

  it("история пишет числа по-русски: «1 200», а не «1200»", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      await screen.findByRole("button", { name: "История назначений" }),
    );
    const table = await screen.findByRole("table", {
      name: "История назначений",
    });
    expect(
      within(table).getAllByText(formatKcal(1200), { normalizer: (t) => t })
        .length,
    ).toBeGreaterThan(0);
    expect(within(table).queryByText("1200")).toBeNull();
    expect(within(table).getAllByText(formatGrams(26)).length).toBeGreaterThan(
      0,
    );
  });

  it("история — панелью по кнопке и в адресе, а форма во всю ширину", async () => {
    // Аудит продукта 12.11.2026: колонка истории рядом с формой выталкивала
    // «Сохранить» за нижний край экрана.
    const user = userEvent.setup();
    renderView();

    await screen.findByRole("button", { name: "Сохранить назначение" });
    expect(screen.queryByRole("table")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "История назначений" }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(currentAddress()).toMatchObject({ item: "history" });
  });

  it("печать называет, что будет на листе", async () => {
    renderView();

    expect(
      await screen.findByRole("button", { name: "Печать: назначение" }),
    ).toBeInTheDocument();
  });

  it("после записи назначения предлагает выдать код семье, пока она не подключена", async () => {
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path === "/api/v1/patients/{patient_id}/prescriptions") {
        return Promise.resolve({
          data: { items: history.items, total: history.items.length },
        });
      }
      if (path === "/api/v1/patients/{patient_id}/overview") {
        return Promise.resolve({
          data: { family_activated: false, last_weight: null },
        });
      }
      if (path === "/api/v1/patients/{patient_id}/custom-dish-review") {
        return Promise.resolve({ data: { off_target: [] } });
      }
      return Promise.resolve({
        data:
          path.includes("aed-drugs") || path.includes("intake")
            ? []
            : { items: [], total: 0 },
      });
    });
    const user = userEvent.setup();
    renderView();

    const field = () => nativeSelect(screen.getByLabelText("Кетосоотношение"));
    await waitFor(() => expect(field().value).toBe("4"));
    // До записи следующего шага нет: он о только что записанном назначении.
    expect(screen.queryByRole("link", { name: /Выдать код семье/ })).toBeNull();

    fireEvent.change(field(), { target: { value: "3.5" } });
    await user.click(
      screen.getByRole("button", { name: "Сохранить назначение" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Подтвердить назначение" }),
    );

    const next = await screen.findByRole("link", { name: /Выдать код семье/ });
    expect(next.getAttribute("href")).toBe(
      `/app/patients/${PATIENT_ID}/profile?item=access-code`,
    );
  });

  it("без истории формы нет — новая версия строится от действующей", async () => {
    // Прежде при отказе истории форма открывалась пустой как «первое
    // назначение», и врач мог записать версию, не видя действующей.
    (api.GET as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/patients/{patient_id}/prescriptions"
          ? { error: { error: { code: "internal", message: "сбой" } } }
          : { data: { items: [], total: 0 } },
      ),
    );
    renderView();

    expect(
      await screen.findByText(doctorRu.prescription.formWaiting),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Сохранить/ })).toBeNull();
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
