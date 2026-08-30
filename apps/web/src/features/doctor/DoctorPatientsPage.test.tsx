import { Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import doctorRu from "../../locales/ru/doctor.json";
import { SectionRouter } from "../../test/SectionRouter";
import { SessionProvider } from "../auth/session";
import { DoctorPatientsPage } from "./DoctorPatientsPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

// Пространство имён экрана подключает координатор (`lib/i18n.ts` — общий файл),
// поэтому тест регистрирует словарь сам: иначе проверялись бы ключи, а не текст.
i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const DOCTOR_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SILENT_ID = "11111111-1111-4111-8111-111111111111";
const FRESH_ID = "22222222-2222-4222-8222-222222222222";

/** Токен разбирается только для claims: подпись клиент не проверяет. */
const ACCESS_TOKEN = `header.${btoa(
  JSON.stringify({ sub: DOCTOR_ID, role: "doctor" }),
)}.signature`;

const PATIENTS = {
  items: [
    {
      id: SILENT_ID,
      full_name: "Иван Петров",
      birth_date: "2020-05-14",
      sex: "m",
      height_cm: 108,
      allergies: [],
      notes: null,
    },
    {
      id: FRESH_ID,
      full_name: "Анна Сидорова",
      birth_date: "2018-02-03",
      sex: "f",
      height_cm: 124,
      allergies: ["орехи"],
      notes: null,
    },
  ],
  total: 2,
};

const TOTALS = {
  kcal: 1180,
  fat: 110,
  protein: 25,
  carbs: 9,
  fiber: 3,
  ratio: 3.2,
};

const ACTIVE_PRESCRIPTION = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  patient_id: SILENT_ID,
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

const OLD_PRESCRIPTION = {
  ...ACTIVE_PRESCRIPTION,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ratio: 3,
  effective_from: "2026-06-01",
  created_at: "2026-06-01T09:00:00Z",
};

const CREATED_PRESCRIPTION = {
  ...ACTIVE_PRESCRIPTION,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ratio: 3.5,
  effective_from: "2026-08-28",
  created_at: "2026-08-28T10:00:00Z",
};

/** Молчащий пациент: последний замер за неделю до даты сводки. */
const SILENT_OVERVIEW = {
  patient_id: SILENT_ID,
  date: "2026-08-28",
  prescription: ACTIVE_PRESCRIPTION,
  day: {
    totals: TOTALS,
    // Вердикт о допусках даёт сервер — экран его только показывает.
    tolerance: { ratio_within_tolerance: false, kcal_within_tolerance: true },
    engine_version: "1.0.0",
  },
  last_ketone: {
    value: 2.9,
    method: "blood",
    occurred_at: "2026-08-18T08:00:00+05:00",
  },
  last_weight: null,
  seizures_today: { entries: 0, count: 0 },
};

const FRESH_OVERVIEW = {
  patient_id: FRESH_ID,
  date: "2026-08-28",
  prescription: { ...ACTIVE_PRESCRIPTION, patient_id: FRESH_ID, ratio: 3 },
  day: {
    totals: TOTALS,
    tolerance: { ratio_within_tolerance: true, kcal_within_tolerance: true },
    engine_version: "1.0.0",
  },
  last_ketone: {
    value: 3.4,
    method: "blood",
    occurred_at: "2026-08-28T07:30:00+05:00",
  },
  last_weight: null,
  seizures_today: { entries: 0, count: 0 },
};

let history: { items: (typeof ACTIVE_PRESCRIPTION)[] };

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // Toaster монтируется в `AppLayout`, а тест рендерит экран отдельно: без него
  // сообщение об успехе некуда показать (правило П16 канона — успех тостом).
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          {/* Карта пациента держит вкладку в адресе (правило П30), поэтому
              экрану нужен роутер — как и в работающем приложении. */}
          <SectionRouter section="patients">{children}</SectionRouter>
          <Toaster />
        </SessionProvider>
      </QueryClientProvider>
    );
  }

  return render(<DoctorPatientsPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  history = { items: [ACTIVE_PRESCRIPTION, OLD_PRESCRIPTION] };

  (api.GET as Mock).mockImplementation(
    (
      path: string,
      options: { params?: { path?: { patient_id?: string } } },
    ) => {
      if (path === "/api/v1/patients") {
        return Promise.resolve({ data: PATIENTS });
      }
      if (path === "/api/v1/patients/{patient_id}/overview") {
        return Promise.resolve({
          data:
            options.params?.path?.patient_id === SILENT_ID
              ? SILENT_OVERVIEW
              : FRESH_OVERVIEW,
        });
      }
      if (path === "/api/v1/patients/{patient_id}/prescriptions") {
        return Promise.resolve({
          data: { items: history.items, total: history.items.length },
        });
      }
      throw new Error(`Unexpected GET ${path}`);
    },
  );

  (api.POST as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/auth/refresh") {
      return Promise.resolve({ data: { access_token: ACCESS_TOKEN } });
    }
    if (path === "/api/v1/patients/{patient_id}/prescriptions") {
      history = { items: [CREATED_PRESCRIPTION, ...history.items] };
      return Promise.resolve({ data: CREATED_PRESCRIPTION });
    }
    throw new Error(`Unexpected POST ${path}`);
  });
});

describe("Список пациентов", () => {
  it("помечает молчание и выход соотношения за допуск, поднимая такие строки наверх", async () => {
    renderPage();

    expect(await screen.findByText("Иван Петров")).toBeInTheDocument();

    // Последний замер 18 августа, дата сводки — 28-е: десять суток молчания.
    expect(await screen.findByText("Нет замеров: 10 дн.")).toBeInTheDocument();

    // Именно в таблице: тот же текст есть в расшифровке флагов под ней.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Кетосоотношение вне допуска")).toBeInTheDocument();
    // Спокойная строка тоже несёт давность данных: правило П19 требует её в
    // каждой строке, иначе врач не отличает ребёнка с утренним замером от
    // ребёнка с записью позавчера.
    expect(
      table.getByText(
        /Без замечаний · данные \d+ дн\. назад|Без замечаний · данные сегодня/,
      ),
    ).toBeInTheDocument();

    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("td")?.textContent);
    expect(names).toEqual(["Иван Петров", "Анна Сидорова"]);
  });
});

describe("Форма назначения", () => {
  it("не отправляет кетосоотношение вне шага 0,5 и показывает версию после сохранения", async () => {
    const user = userEvent.setup();
    renderPage();

    // Сначала дожидаемся флагов: до этого строки стоят в алфавитном порядке и
    // после загрузки сводок перестраиваются.
    await screen.findByText("Нет замеров: 10 дн.");

    await user.click(
      screen.getByRole("button", {
        name: "Открыть карту пациента Иван Петров",
      }),
    );
    await user.click(screen.getByRole("tab", { name: "Назначение" }));

    const ratio = await screen.findByLabelText("Кетосоотношение");
    await user.clear(ratio);
    await user.type(ratio, "3.7");
    await user.click(
      screen.getByRole("button", { name: "Сохранить назначение" }),
    );

    expect(
      await screen.findByText("Кетосоотношение — от 1,0 до 5,0 с шагом 0,5."),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/prescriptions",
      expect.anything(),
    );

    await user.clear(ratio);
    await user.type(ratio, "3.5");
    await user.click(
      screen.getByRole("button", { name: "Сохранить назначение" }),
    );

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/prescriptions",
      expect.objectContaining({
        params: { path: { patient_id: SILENT_ID } },
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
});
