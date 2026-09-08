import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import type { Session } from "./features/auth/claims";
import type { Role } from "./features/auth/roles";
import { router } from "./router";

const PATIENT = "11111111-1111-4111-8111-111111111111";

function session(role: Role): Session {
  return { userId: "u1", role, patientScope: null };
}

/**
 * Куда роутер приводит по адресу — без рендера экранов.
 *
 * `router.load()` выполняет `beforeLoad` всех совпавших маршрутов, а именно там
 * живут переводы устаревших ссылок и защита разделов по роли. Проверять это
 * через рендер значило бы поднимать половину кабинета ради одной строчки
 * решения.
 */
async function resolve(path: string, role: Role): Promise<string> {
  router.update({
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { session: session(role) },
  });
  await router.load();
  return router.state.location.href;
}

describe("адреса кабинета", () => {
  describe("прежние ссылки на карту пациента", () => {
    it("открывают ту же карту на том же разделе", async () => {
      // `/app/patients?patient=<id>&tab=diary` лежит в закладках врачей и в
      // переписке. Новая раскладка, купленная ценой оборванных ссылок, — плохая
      // покупка: перевод стоит одного `beforeLoad`.
      expect(
        await resolve(`/app/patients?patient=${PATIENT}&tab=diary`, "doctor"),
      ).toBe(`/app/patients/${PATIENT}/diary`);
    });

    it("без вкладки открывают сводку", async () => {
      expect(await resolve(`/app/patients?patient=${PATIENT}`, "doctor")).toBe(
        `/app/patients/${PATIENT}/summary`,
      );
    });

    it("переносят вид дневника, а не теряют его", async () => {
      // Быстрые переходы вели в карту сразу на нужный вид дневника, и потеря
      // `kind` означала бы «открылось, но не то».
      expect(
        await resolve(
          `/app/patients?patient=${PATIENT}&tab=diary&kind=ketones`,
          "doctor",
        ),
      ).toBe(`/app/patients/${PATIENT}/diary?kind=ketones`);
    });

    it("не трогают реестр без выбранного пациента", async () => {
      expect(await resolve("/app/patients", "doctor")).toBe("/app/patients");
    });
  });

  describe("карта пациента", () => {
    it("адрес без раздела открывает сводку", async () => {
      // Ссылка, набранная руками или обрезанная почтовым клиентом, обязана
      // открывать карту, а не пустоту.
      expect(await resolve(`/app/patients/${PATIENT}`, "doctor")).toBe(
        `/app/patients/${PATIENT}/summary`,
      );
    });

    it("несуществующий раздел уводит на сводку, а не в 404", async () => {
      expect(
        await resolve(`/app/patients/${PATIENT}/нет-такого`, "doctor"),
      ).toBe(`/app/patients/${PATIENT}/summary`);
    });

    it("заметки врача не открываются диетологу", async () => {
      // Сервер отдаёт их одной роли. Пускать по ссылке на заведомый 403 —
      // тупик; это UX, права проверяет сервер.
      expect(await resolve(`/app/patients/${PATIENT}/notes`, "dietitian")).toBe(
        `/app/patients/${PATIENT}/summary`,
      );
      expect(await resolve(`/app/patients/${PATIENT}/notes`, "doctor")).toBe(
        `/app/patients/${PATIENT}/notes`,
      );
    });

    it("семье карта пациента не открывается: у неё свой кабинет", async () => {
      expect(await resolve(`/app/patients/${PATIENT}/summary`, "parent")).toBe(
        "/app/home",
      );
    });
  });
});
