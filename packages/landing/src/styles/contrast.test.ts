/**
 * Контраст текста в обеих темах — не меньше 4.5 : 1 (WCAG AA).
 *
 * Тёмная тема прежде включалась сама и не проходила контраст в пяти местах:
 * цвета были подобраны на глаз. Проверка читает токены прямо из стилей,
 * поэтому новая пара «текст на фоне» без проверки не появится.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "global.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`нет блока ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Какой текст на каком фоне стоит на сайте. */
const PAIRS: [text: string, background: string][] = [
  ["ink", "bg"],
  ["ink", "surface"],
  ["ink", "surface-alt"],
  ["ink-muted", "bg"],
  ["ink-muted", "surface"],
  ["ink-muted", "surface-alt"],
  ["link", "bg"],
  ["link", "surface"],
  ["link", "surface-alt"],
  ["link", "primary-tint"],
  ["on-primary", "primary"],
  ["on-primary", "primary-hover"],
  ["success", "success-bg"],
  ["success", "surface"],
  ["warn-strong", "warn-bg"],
  ["danger", "surface"],
  ["footer-ink", "footer-bg"],
  ["footer-muted", "footer-bg"],
];

const light = tokens(":root");
const dark = { ...light, ...tokens('[data-theme="dark"]') };

describe.each([
  ["светлая", light],
  ["тёмная", dark],
])("тема %s", (_name, theme) => {
  it.each(PAIRS)("%s на %s — не меньше 4.5 : 1", (text, background) => {
    const fg = theme[text];
    const bg = theme[background];
    expect(fg, `нет токена --${text}`).toBeDefined();
    expect(bg, `нет токена --${background}`).toBeDefined();
    expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  });
});
