/**
 * Рисует картинки для карточек в соцсетях (og:image) и apple-touch-icon.
 *
 * Запускается ВРУЧНУЮ (`pnpm --filter @ketocare/landing og`), а результат
 * лежит в репозитории. Нарочно не часть `build`: отрисовка текста зависит
 * от шрифтов операционной системы, и на голом сервере сборка либо упала бы,
 * либо тихо выдала квадраты вместо букв — на картинке, которую увидят все,
 * кому отправят ссылку.
 *
 * Меняли текст в словаре — перегенерируйте и закоммитьте PNG.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Короткие подписи для картинки: полный заголовок страницы в 1200×630 не влезает. */
const CARDS = {
  ru: {
    title: "Кетогенная диета ребёнка —\nточно по назначению врача",
    sub: "Расчёт блюд, дневники и динамика для врача",
  },
  uz: {
    title: "Bolaning ketogen dietasi —\nshifokor tayinlovi bo‘yicha aniq",
    sub: "Taomlar hisobi, kundaliklar va shifokor uchun dinamika",
  },
  en: {
    title: "A child’s ketogenic diet —\nexactly as prescribed",
    sub: "Meal calculations, diaries and trends for the clinician",
  },
};

const escape = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function cardSvg({ title, sub }) {
  const lines = title.split("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="82%" cy="12%" r="55%">
      <stop offset="0%" stop-color="#7fa6ff" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#7fa6ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#16213e"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <rect x="80" y="72" width="56" height="56" rx="16" fill="#2c5fe0"/>
  <text x="108" y="110" font-family="Helvetica, Arial, sans-serif" font-size="27"
        font-weight="700" fill="#ffffff" text-anchor="middle">K</text>
  <text x="152" y="110" font-family="Helvetica, Arial, sans-serif" font-size="30"
        font-weight="700" fill="#e8edf7">KetoCare</text>

  ${lines
    .map(
      (line, i) =>
        `<text x="80" y="${292 + i * 74}" font-family="Georgia, 'Times New Roman', serif" font-size="60" font-weight="700" fill="#ffffff">${escape(line)}</text>`,
    )
    .join("\n  ")}

  <text x="80" y="${292 + lines.length * 74 + 26}" font-family="Helvetica, Arial, sans-serif"
        font-size="28" fill="#9aa8bf">${escape(sub)}</text>

  <rect x="80" y="540" width="120" height="8" rx="4" fill="#2c5fe0"/>
  <rect x="208" y="540" width="48" height="8" rx="4" fill="#f5a623"/>
  <rect x="264" y="540" width="32" height="8" rx="4" fill="#c0392b"/>
</svg>`;
}

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" rx="40" fill="#2c5fe0"/>
  <text x="90" y="124" font-family="Helvetica, Arial, sans-serif" font-size="96"
        font-weight="700" fill="#ffffff" text-anchor="middle">K</text>
</svg>`;

await mkdir(resolve(root, "public/og"), { recursive: true });

for (const [locale, card] of Object.entries(CARDS)) {
  const out = resolve(root, `public/og/${locale}.png`);
  await sharp(Buffer.from(cardSvg(card)))
    .png()
    .toFile(out);
  console.log(`og: ${out}`);
}

await sharp(Buffer.from(iconSvg))
  .png()
  .toFile(resolve(root, "public/apple-touch-icon.png"));
console.log("og: apple-touch-icon.png");

/* Favicon остаётся вектором: он рисуется без текста и не зависит от шрифтов. */
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#2c5fe0"/>
  <path d="M10 7h3.6v7.4L20 7h4.4l-7 8 7.4 10h-4.4l-5.4-7.4-1.4 1.6V25H10z" fill="#fff"/>
</svg>`;
await writeFile(resolve(root, "public/favicon.svg"), favicon, "utf8");
console.log("og: favicon.svg");
