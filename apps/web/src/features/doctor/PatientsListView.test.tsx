import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { SectionRouter } from "../../test/SectionRouter";
import { SessionProvider } from "../auth/session";
import { PatientsListView } from "./PatientsListView";

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

const PATIENTS = [
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
];

const TOTALS = {
  kcal: 1180,
  fat: 110,
  protein: 25,
  carbs: 9,
  fiber: 3,
  ratio: 3.2,
};

const PRESCRIPTION = {
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

/** Молчащий пациент: последний замер за десять суток до даты сводки. */
const SILENT_OVERVIEW = {
  patient_id: SILENT_ID,
  date: "2026-08-28",
  prescription: PRESCRIPTION,
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
  seizure_trend: { recent: 0, previous: 0, grew: null, appeared: false },
  last_reading_on: "2026-08-18",
};

const FRESH_OVERVIEW = {
  patient_id: FRESH_ID,
  date: "2026-08-28",
  prescription: { ...PRESCRIPTION, patient_id: FRESH_ID, ratio: 3 },
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
  seizure_trend: { recent: 0, previous: 0, grew: null, appeared: false },
  last_reading_on: "2026-08-28",
};

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          {/* Строка поиска живёт в состоянии экрана, но ссылки на карту —
              адресные, и без роутера они бы не собрались. */}
          <SectionRouter section="patients">{children}</SectionRouter>
        </SessionProvider>
      </QueryClientProvider>
    );
  }

  return render(<PatientsListView />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();

  (api.GET as Mock).mockImplementation(
    (
      path: string,
      options: { params?: { path?: { patient_id?: string } } },
    ) => {
      if (path === "/api/v1/patients") {
        // Поиск делает сервер: тест отвечает так же, как ответил бы он.
        const q = (options.params as { query?: { q?: string } } | undefined)
          ?.query?.q;
        const items =
          q === undefined
            ? PATIENTS
            : PATIENTS.filter((patient) =>
                patient.full_name.toLowerCase().includes(q.toLowerCase()),
              );
        return Promise.resolve({ data: { items, total: items.length } });
      }
      if (path === "/api/v1/patients/{patient_id}/overview") {
        return Promise.resolve({
          data:
            options.params?.path?.patient_id === SILENT_ID
              ? SILENT_OVERVIEW
              : FRESH_OVERVIEW,
        });
      }
      return Promise.resolve({ data: { items: [], total: 0 } });
    },
  );

  (api.POST as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/auth/refresh") {
      return Promise.resolve({ data: { access_token: ACCESS_TOKEN } });
    }
    throw new Error(`Unexpected POST ${path}`);
  });
});

describe("реестр пациентов", () => {
  it("помечает молчание и выход соотношения за допуск, поднимая такие строки наверх", async () => {
    renderList();

    // Сначала дожидаемся сводок: до них строки стоят в алфавитном порядке и
    // после их прихода перестраиваются, поэтому узел, взятый раньше, к моменту
    // проверки уже откреплён от документа.
    //
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

  it("имя ведёт в карту пациента по её собственному адресу", async () => {
    // Карта живёт своим уровнем пути (правило П41), и ссылку врач открывает в
    // новой вкладке, копирует и пересылает коллеге. Пока карта была параметром
    // списка, ссылка вела на список.
    renderList();

    const link = await screen.findByRole("link", { name: "Иван Петров" });
    expect(link.getAttribute("href")).toBe(
      `/app/patients/${SILENT_ID}/summary`,
    );
  });

  it("поиск спрашивает сервер, а не отбирает загруженную страницу", async () => {
    // Список приходит первыми двумя сотнями строк. Поиск по ним отвечал «не
    // найдено» о пациенте, который есть, — и выглядел этот ответ достоверным.
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Иван Петров");
    await user.type(screen.getByLabelText(/Поиск по имени/), "петров");

    await waitFor(() => {
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/patients",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ q: "петров" }),
          }),
        }),
      );
    });
  });
});
