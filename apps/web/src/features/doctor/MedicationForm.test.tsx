import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { FIELD_ORDER, MedicationForm } from "./MedicationForm";

vi.mock("../intake/useIntake", () => ({
  useAedDrugs: () => ({ data: [] }),
}));

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

/**
 * `FIELD_ORDER` решает, на какое поле встанет фокус после неудачной отправки.
 *
 * Список явный, потому что вывести его неоткуда: `react-hook-form` знает
 * порядок РЕГИСТРАЦИИ (у поля препарата он другой — оно идёт через
 * `Controller`), а zod — порядок объявления схемы, который с разметкой
 * совпадать не обязан. Сегодня они совпадают случайно; перестановка полей на
 * экране вернула бы дефект молча, поэтому связь держится тестом.
 */
describe("порядок полей формы препарата", () => {
  it("совпадает с порядком на экране", () => {
    render(
      <MedicationForm
        medication={null}
        pending={false}
        error={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Кратность — список: `select` входит в порядок наравне с полями ввода.
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "form input[name], form select[name]",
      ),
    ).map((input) => input.name);

    expect(inputs).toEqual([...FIELD_ORDER]);
  });
});
