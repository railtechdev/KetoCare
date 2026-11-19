import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DocumentFrame } from "../../features/letterhead/useDocumentFrame";
import "../../lib/i18n";
import { PrintedSheets } from "./PrintedSheets";

const FRAME: DocumentFrame = {
  shortName: "ДНЦ «Образец»",
  logoUrl: "blob:logo",
  logoBlob: undefined,
  familyPhone: "+998 71 000-00-00",
  author: "Иванова Анна Петровна, диетолог",
  generatedAt: "20.11.2026, 14:05",
};

const SHEETS = [
  {
    key: "rx",
    title: "Назначение",
    aside: "Мария О.",
    code: "KC-RX-1",
    content: <p>лист 1</p>,
  },
  {
    key: "d1",
    title: "Меню на пт, 20 нояб.",
    aside: "Мария О.",
    code: "KC-WEEK-1",
    content: <p>лист 2</p>,
  },
];

describe("PrintedSheets (ADR-0092)", () => {
  it("gives every sheet the clinic header and «Стр. X из Y»", () => {
    const { container } = render(
      <PrintedSheets frame={FRAME} sheets={SHEETS} />,
    );

    const sheets = container.querySelectorAll(".print-sheet");
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toHaveTextContent("ДНЦ «Образец»");
    expect(sheets[0]).toHaveTextContent("Стр. 1 из 2");
    expect(sheets[1]).toHaveTextContent("Меню на пт, 20 нояб.");
    expect(sheets[1]).toHaveTextContent("Стр. 2 из 2");
    expect(sheets[1]).toHaveTextContent("KetoCare · KC-WEEK-1");
  });

  it("puts the family phone and the author in the footer", () => {
    render(<PrintedSheets frame={FRAME} sheets={SHEETS.slice(0, 1)} />);

    expect(
      screen.getByText(/Вопросы по диете: \+998 71 000-00-00/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /сформировал\(а\) Иванова Анна Петровна, диетолог, 20\.11\.2026, 14:05/,
      ),
    ).toBeInTheDocument();
  });

  it("leaves the family phone off a sheet for the staff", () => {
    render(
      <PrintedSheets
        frame={FRAME}
        sheets={SHEETS.slice(0, 1)}
        audience="staff"
      />,
    );

    expect(screen.queryByText(/Вопросы по диете/)).toBeNull();
  });
});
