import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import diaryRu from "../../locales/ru/diary.json";
import type { DiaryLog } from "./diaryApi";
import { SeizureDiaryGrid } from "./SeizureDiaryGrid";

i18n.addResourceBundle("ru", "diary", diaryRu, true, true);

const TYPES = [
  { id: "t-gtc", name: "Генерализованный тонико-клонический", code: "ГТКП" },
  { id: "t-abs", name: "Абсанс", code: "А" },
  { id: "t-myo", name: "Миоклонический", code: "М" },
];

const LOG = {
  kind: "seizures",
  id: "s1",
  patient_id: "p1",
  occurred_at: "2026-08-29T08:00:00",
  seizure_type_id: "t-gtc",
  count: 1,
  author_user_id: "u1",
  created_at: "2026-08-29T08:00:00Z",
} as unknown as DiaryLog;

describe("сетка приступов", () => {
  it("клетка читается: «1 × ГТКП», а не «1ГТКП»", () => {
    render(<SeizureDiaryGrid logs={[LOG]} types={TYPES} />);

    expect(screen.getByText("1 × ГТКП")).toBeInTheDocument();
  });

  it("легенда объясняет коды на сетке, а не перечисляет справочник", () => {
    render(<SeizureDiaryGrid logs={[LOG]} types={TYPES} />);

    const legend = screen.getByText(/^Обозначения:/);
    expect(legend).toHaveTextContent("ГТКП");
    expect(legend).not.toHaveTextContent("Абсанс");
    expect(legend).not.toHaveTextContent("Миоклонический");
  });
});
