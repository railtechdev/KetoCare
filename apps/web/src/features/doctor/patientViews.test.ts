import { describe, expect, it } from "vitest";

import { ROLES } from "../auth/roles";
import {
  DEFAULT_PATIENT_VIEW,
  PATIENT_VIEWS,
  PATIENT_VIEW_ICONS,
  PATIENT_VIEW_SCREENS,
  PATIENT_VIEW_WIDTH,
  isPatientView,
  patientViewFromTab,
  patientViewsFor,
} from "./patientViews";

describe("разделы карты пациента", () => {
  it("у каждого раздела есть экран и значок", () => {
    // Раздел без экрана — пункт меню, ведущий в пустоту; без значка — дырка в
    // навигации. И то и другое заметно только глазами, поэтому проверяется тут
    // (то же правило, что у разделов кабинета в `routes/sections.test.ts`).
    expect(
      PATIENT_VIEWS.filter((view) => !(view in PATIENT_VIEW_SCREENS)),
    ).toEqual([]);
    expect(
      PATIENT_VIEWS.filter((view) => !(view in PATIENT_VIEW_ICONS)),
    ).toEqual([]);
  });

  it("ширина раздела названа ролью, а не числом", () => {
    // Правило П34: разделы карты — разные страницы. Дневники сравнивают ряды,
    // сводку читают, и одна ширина на всех означала бы, что роль не выбрана.
    for (const view of PATIENT_VIEWS) {
      expect(["form", "content", "wide", "full"]).toContain(
        PATIENT_VIEW_WIDTH[view],
      );
    }
  });

  it("не объявляет экранов для несуществующих разделов", () => {
    const known = new Set<string>(PATIENT_VIEWS);
    expect(
      Object.keys(PATIENT_VIEW_SCREENS).filter((view) => !known.has(view)),
    ).toEqual([]);
    expect(
      Object.keys(PATIENT_VIEW_ICONS).filter((view) => !known.has(view)),
    ).toEqual([]);
  });

  it("раздел по умолчанию доступен каждой роли, которой открыта карта", () => {
    // На него уводят и адрес без раздела, и устаревшая ссылка. Окажись он
    // закрыт для роли, `beforeLoad` отправлял бы на него по кругу.
    for (const role of ROLES) {
      const views = patientViewsFor(role);
      expect(views).toContain(DEFAULT_PATIENT_VIEW);
    }
  });

  it("заметки видит только врач", () => {
    // Сервер отдаёт клинические заметки одной роли (`clinical.py`). Пункт меню
    // у диетолога вёл бы в заведомый 403 — это тупик, а не ограничение прав.
    expect(patientViewsFor("doctor")).toContain("notes");
    expect(patientViewsFor("dietitian")).not.toContain("notes");
    expect(patientViewsFor(undefined)).not.toContain("notes");
  });

  it("анамнез диетологу — на чтение, правит его врач", () => {
    // Ответ клиники 09.09.2026 (вопросы 7 и 31): «Диетолог может видеть
    // диагноз… но не вносить изменения». Сервер разводит это на две проверки
    // (`GET /medical-profile` — врач и диетолог, `PUT` — врач), и реестр обязан
    // повторять ту же границу: иначе диетолог получал бы либо пустой раздел при
    // открытой ручке, либо кнопку, ведущую в 403.
    //
    // Проверяются пропы, а не отрисовка: экран профиля тянет пять запросов и
    // свой разбор здесь ничего бы не добавил — его границы закреплены в
    // `PatientProfileView.test.tsx`. Здесь проверяется ПРОВОДКА.
    const patient = { id: "p1" } as never;
    const forDietitian = PATIENT_VIEW_SCREENS.profile(patient, "dietitian")
      .props as Record<string, unknown>;
    const forDoctor = PATIENT_VIEW_SCREENS.profile(patient, "doctor")
      .props as Record<string, unknown>;

    expect(forDietitian.clinicalAllowed).toBe(true);
    expect(forDietitian.clinicalEditable).toBe(false);
    expect(forDoctor.clinicalAllowed).toBe(true);
    expect(forDoctor.clinicalEditable).toBe(true);
  });

  it("узнаёт свои разделы и не признаёт чужих", () => {
    expect(isPatientView("diary")).toBe(true);
    expect(isPatientView("prescriptions")).toBe(false);
  });

  describe("прежние ссылки на вкладки карты", () => {
    it("открывают тот же раздел", () => {
      // Ссылки вида `?patient=<id>&tab=diary` лежат в закладках и в переписке
      // врачей: перевод обязан быть, иначе новая раскладка куплена ценой
      // сломанных ссылок.
      expect(patientViewFromTab("diary")).toBe("diary");
      expect(patientViewFromTab("reports")).toBe("reports");
    });

    it("ведут к назначению с вкладки лекарств, которой уже нет", () => {
      // Лекарства переехали к назначению раньше этой работы, и вкладка
      // `medications` осталась только в старых ссылках.
      expect(patientViewFromTab("medications")).toBe("prescription");
    });

    it("без вкладки и с неизвестной вкладкой открывают сводку", () => {
      expect(patientViewFromTab(undefined)).toBe(DEFAULT_PATIENT_VIEW);
      expect(patientViewFromTab("нет-такой")).toBe(DEFAULT_PATIENT_VIEW);
    });
  });
});
