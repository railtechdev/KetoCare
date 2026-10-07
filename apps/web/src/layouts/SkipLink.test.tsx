import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import "../lib/i18n";
import { MAIN_CONTENT_ID, SkipLink } from "./SkipLink";

describe("SkipLink (правило П21)", () => {
  it("переносит фокус в основную область, минуя навигацию", async () => {
    render(
      <>
        <SkipLink />
        <nav>
          <a href="/app/home">Главная</a>
        </nav>
        <main id={MAIN_CONTENT_ID} tabIndex={-1}>
          содержимое
        </main>
      </>,
    );

    const user = userEvent.setup();
    // Первая остановка Tab — именно ссылка в обход, а не пункт меню.
    await user.tab();
    const link = screen.getByRole("link", { name: "Перейти к содержимому" });
    expect(link).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("стоит в каркасе раньше шапки и боковой панели, цель — main с tabIndex -1", () => {
    // Каркас целиком требует сессии, роутера и профиля; порядок разметки и
    // атрибуты цели проверяются по исходнику — их и легко потерять правкой.
    const source = readFileSync(join(__dirname, "AppLayout.tsx"), "utf8");
    const skip = source.indexOf("<SkipLink />");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(source.indexOf("<aside"));
    expect(skip).toBeLessThan(source.indexOf("<header"));
    expect(source).toMatch(/<main\s+id=\{MAIN_CONTENT_ID\}\s+tabIndex=\{-1\}/);
  });
});
