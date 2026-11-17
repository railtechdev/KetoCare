import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { buildWordDocument, downloadBlob } from "../lib/wordExport";
import { WordButton } from "./WordButton";

vi.mock("../lib/wordExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/wordExport")>();
  return { ...actual, buildWordDocument: vi.fn(), downloadBlob: vi.fn() };
});

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("@ketocare/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ketocare/ui")>();
  return { ...actual, toast: { ...actual.toast, error: toastError } };
});

const MODEL = { title: "Меню", sections: [] };

beforeEach(() => vi.clearAllMocks());

describe("WordButton (ADR-0088)", () => {
  it("builds the document at the click and downloads it under a safe name", async () => {
    const blob = new Blob(["docx"]);
    (buildWordDocument as Mock).mockResolvedValue(blob);
    const build = vi.fn(() => MODEL);
    const user = userEvent.setup();
    render(
      <WordButton label="Скачать Word" fileName="Меню: Эмир" build={build} />,
    );

    await user.click(screen.getByRole("button", { name: "Скачать Word" }));

    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(blob, "Меню Эмир.docx"),
    );
    expect(build).toHaveBeenCalledTimes(1);
    expect(buildWordDocument).toHaveBeenCalledWith(MODEL);
  });

  it("says so when the file could not be made", async () => {
    (buildWordDocument as Mock).mockRejectedValue(new Error("chunk failed"));
    const user = userEvent.setup();
    render(
      <WordButton label="Скачать Word" fileName="Меню" build={() => MODEL} />,
    );

    await user.click(screen.getByRole("button", { name: "Скачать Word" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(downloadBlob).not.toHaveBeenCalled();
    // После отказа кнопка снова доступна: повтор — то, что человек сделает.
    expect(screen.getByRole("button", { name: "Скачать Word" })).toBeEnabled();
  });

  it("is off, with its reason, when there is nothing to export", () => {
    render(
      <>
        <WordButton
          label="Скачать Word"
          fileName="Меню"
          build={() => MODEL}
          disabled
          describedBy="why"
        />
        <p id="why">На этой неделе нет блюд</p>
      </>,
    );

    const button = screen.getByRole("button", { name: "Скачать Word" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("На этой неделе нет блюд");
  });
});
