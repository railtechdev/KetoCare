// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Проверка требования доступности раздела 8.2 ТЗ: контраст >= 4.5:1.
 *
 * Значения читаются из самого tokens.css, а не дублируются здесь: иначе тест
 * подтверждал бы свою собственную копию палитры, а не ту, что видит пользователь.
 */

const CSS = readFileSync(
  fileURLToPath(new URL("./tokens.css", import.meta.url)),
  "utf-8",
);

function themeBlock(selector: string): string {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`Блок ${selector} не найден в tokens.css`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open, close);
}

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`Токен --${name} не найден`);
  return match[1];
}

/** Относительная яркость по WCAG 2.1. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const MIN_CONTRAST = 4.5;

describe.each([
  ["светлая тема", "@theme"],
  ["тёмная тема", '[data-theme="dark"]'],
])("%s", (_name, selector) => {
  const block = themeBlock(selector);

  it.each([
    ["background", "foreground"],
    ["card", "card-foreground"],
    ["popover", "popover-foreground"],
    ["secondary", "secondary-foreground"],
    ["accent", "accent-foreground"],
    ["sidebar", "sidebar-foreground"],
  ])("текст на подложке %s читаем", (surface, text) => {
    expect(
      contrastRatio(
        token(block, `color-${text}`),
        token(block, `color-${surface}`),
      ),
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it.each([
    ["primary", "primary-foreground"],
    ["destructive", "destructive-foreground"],
    ["warning", "on-warning"],
    ["success", "on-success"],
    ["sidebar-primary", "sidebar-primary-foreground"],
  ])("текст на цветной подложке %s читаем", (surface, text) => {
    expect(
      contrastRatio(
        token(block, `color-${text}`),
        token(block, `color-${surface}`),
      ),
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("приглушённый текст читаем и на фоне, и на карточке", () => {
    // Приглушённый текст — самое частое, что становится нечитаемым при смене
    // палитры: он ходит по обеим подложкам, а проверяют обычно одну.
    for (const surface of ["background", "card", "muted"]) {
      expect(
        contrastRatio(
          token(block, "color-muted-foreground"),
          token(block, `color-${surface}`),
        ),
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("выбранный пункт боковой навигации читаем", () => {
    expect(
      contrastRatio(
        token(block, "color-sidebar-accent-foreground"),
        token(block, "color-sidebar-accent"),
      ),
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});
