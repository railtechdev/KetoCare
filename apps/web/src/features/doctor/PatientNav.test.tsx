import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { PatientRouter } from "../../test/PatientRouter";
import { PatientNav } from "./PatientNav";
import type { Patient } from "./types";

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

const PATIENT = {
  id: PATIENT_ID,
  full_name: "Иванов Пётр",
  birth_date: "2016-05-01",
  sex: "m",
  height_cm: 120,
  allergies: [],
  notes: null,
} as unknown as Patient;

function renderNav({
  role = "doctor" as const,
  view = "summary",
}: { role?: "doctor" | "dietitian"; view?: string } = {}) {
  return render(
    <PatientRouter patientId={PATIENT_ID} view={view}>
      <PatientNav patient={PATIENT} role={role} />
    </PatientRouter>,
  );
}

describe("навигация карты пациента", () => {
  it("называет, чью карту читает врач, в любом разделе", async () => {
    // Паспорт пациента стоял над вкладками и был виден всегда. Разложив
    // вкладки по адресам, ответ на вопрос «чьи это данные» легко потерять —
    // теперь его держит навигация, и это её главная работа.
    renderNav({ view: "diary" });

    expect(
      await screen.findByRole("heading", { name: "Иванов Пётр" }),
    ).toBeInTheDocument();
  });

  it("даёт выход на уровень выше", async () => {
    renderNav();

    const back = await screen.findByRole("link", { name: /Все пациенты/ });
    expect(back.getAttribute("href")).toBe("/app/patients");
    // Возврат наверх — не текущая страница. Роутер по умолчанию считает
    // открытой и ссылку на начало пути, и без точного совпадения скринридер
    // слышал бы «Все пациенты, текущая страница», стоя в карте пациента.
    expect(back).not.toHaveAttribute("aria-current");
  });

  it("ведёт в разделы того же пациента", async () => {
    renderNav();

    const diary = await screen.findByRole("link", { name: /Дневники/ });
    expect(diary.getAttribute("href")).toBe(
      `/app/patients/${PATIENT_ID}/diary`,
    );
  });

  it("называет открытый раздел, а не только подсвечивает его", async () => {
    // Цвет — не единственный признак (WCAG 1.4.1): открытый раздел назван
    // скринридеру через `aria-current`. Открытым он считается ровно один: до
    // явного признака роутер помечал так и ссылку на начало пути.
    renderNav({ view: "prescription" });

    const nav = await screen.findByRole("list");
    const current = within(nav).getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Назначение");
  });

  it("не показывает диетологу заметок врача", async () => {
    // Сервер отдаёт их одной роли. Пункт меню, ведущий в заведомый 403, — это
    // тупик, а не ограничение прав.
    renderNav({ role: "dietitian" });

    const nav = await screen.findByRole("list");
    expect(within(nav).queryByText("Заметки")).not.toBeInTheDocument();
    expect(within(nav).getByText("Сводка")).toBeInTheDocument();
  });

  it("показывает врачу все разделы карты", async () => {
    renderNav();

    const nav = await screen.findByRole("list");
    expect(within(nav).getAllByRole("listitem")).toHaveLength(7);
  });
});
