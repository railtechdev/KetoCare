import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import childRu from "../../locales/ru/child.json";
import doctorRu from "../../locales/ru/doctor.json";
import { PatientRouter } from "../../test/PatientRouter";
import { PatientProfileView } from "./PatientProfileView";

/** Последний замер веса из сводки; `null` — замеров не было. */
let lastWeight: { weight_kg: number; occurred_at: string } | null = null;
/** Медицинский профиль; `null` — сервер отвечает 404 «ещё не заполнен». */
let medicalProfile: { diagnosis: string | null } | null = null;

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      // Раздел тянет и списки (`{items}`), и справочники (массив), и сводку:
      // ответ выбирается по адресу, иначе один из них падает на разборе.
      GET: vi.fn().mockImplementation((path: string) => {
        if (path.includes("medical-profile")) {
          return Promise.resolve(
            medicalProfile === null
              ? { error: { error: { code: "not_found", message: "нет" } } }
              : { data: medicalProfile },
          );
        }
        if (path.includes("overview")) {
          return Promise.resolve({
            data: {
              date: "2026-09-10",
              prescription: null,
              day: null,
              last_ketone: null,
              last_weight: lastWeight,
              seizures_today: { count: 0 },
            },
          });
        }
        return Promise.resolve({
          data:
            path.includes("colleagues") ||
            path.includes("attachments") ||
            path.includes("parents") ||
            path.includes("doctors") ||
            path.includes("intake-options") ||
            path.includes("aed-drugs")
              ? []
              : { items: [], total: 0 },
        });
      }),
      PATCH: vi.fn(),
    },
  };
});

beforeEach(() => {
  lastWeight = null;
  medicalProfile = null;
  (api.GET as Mock).mockClear();
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

function renderProfile(
  patient: Record<string, unknown> = {},
  { clinicalAllowed = true }: { clinicalAllowed?: boolean } = {},
) {
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
      clinicalAllowed={clinicalAllowed}
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

  it("показывает вес последним замером и с датой", async () => {
    // Заказчица просила «добавить вес рядом с ростом». Второго поля в карточке
    // не появилось: вес уже есть серией замеров, и поле стало бы вторым
    // источником одного числа. Дата обязательна — вес ребёнка на кетодиете
    // быстро устаревает, и «18,2 кг» без даты не говорит, вчерашнее это или
    // трёхмесячной давности.
    lastWeight = { weight_kg: 18.2, occurred_at: "2026-09-07T09:30:00Z" };
    renderProfile();

    const value = await screen.findByText(/18\.2 кг/);
    expect(value).toHaveTextContent("07.09.2026");
  });

  it("показывает диагноз врачу в самом паспорте", async () => {
    // Просьба заказчицы: врач решает, глядя на паспорт, а за диагнозом
    // приходилось прокручивать экран до отдельного блока ниже.
    medicalProfile = { diagnosis: "Синдром Драве" };
    renderProfile();

    // Диагноз стоит в паспорте, а не только в блоке медицинского профиля
    // ниже. Значение приходит запросом, поэтому его и ждём: подпись «Диагноз»
    // рисуется сразу и с прочерком.
    const passport = await screen.findByLabelText(doctorRu.card.passportTitle);
    await waitFor(() =>
      expect(passport).toHaveTextContent(/Диагноз\s*Синдром Драве/),
    );
  });

  it("кому закрыт медицинский профиль — за диагнозом даже не ходит", async () => {
    // Диетологу его пока не открывали: `GET /medical-profile` за ролью врача.
    // Клиника ответила, что диагноз он видеть должен, — это правка ДОСТУПА на
    // сервере, и до неё строка в интерфейсе была бы обещанием без покрытия.
    //
    // Проверяется отсутствие ЗАПРОСА, а не отсутствие текста: текста не будет и
    // так, потому что данным неоткуда взяться, — и тест, смотрящий на экран,
    // прошёл бы даже с открытой строкой. Настоящая граница здесь одна: кабинет
    // не спрашивает то, на что не имеет права, и не собирает 403 в журнале.
    medicalProfile = { diagnosis: "Синдром Драве" };
    renderProfile({}, { clinicalAllowed: false });

    await screen.findByText(/Кокосовое масло/);
    const asked = (api.GET as Mock).mock.calls.some(
      (call) =>
        typeof call[0] === "string" && call[0].includes("medical-profile"),
    );
    expect(asked).toBe(false);
    expect(screen.queryByText("Синдром Драве")).not.toBeInTheDocument();
  });

  it("врач за диагнозом ходит", async () => {
    // Обратная сторона: без этого случая проверка выше проходила бы и на
    // экране, который не запрашивает профиль вообще ни у кого.
    medicalProfile = { diagnosis: "Синдром Драве" };
    renderProfile();

    await waitFor(() =>
      expect(
        (api.GET as Mock).mock.calls.some(
          (call) =>
            typeof call[0] === "string" && call[0].includes("medical-profile"),
        ),
      ).toBe(true),
    );
  });

  it("без замеров так и говорит, а не показывает пусто", async () => {
    renderProfile();

    // Пока сводка не пришла, поле пустое, а не «не измерялся»: «замеров нет» —
    // утверждение, и делать его до ответа сервера нельзя.
    expect(await screen.findByText("Не измерялся")).toBeInTheDocument();
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
