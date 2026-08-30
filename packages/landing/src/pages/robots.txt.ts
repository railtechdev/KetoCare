import type { APIRoute } from "astro";

/**
 * robots.txt собирается, а не лежит в public: домен обязан совпадать с тем,
 * из которого построены canonical и sitemap. Статический файл после переезда
 * на домен клиента продолжал бы указывать на пред-прод.
 *
 * Пред-прод закрыт от индексации: временный домен в выдаче — это дубли
 * страниц, которые потом придётся выковыривать. Открывается переменной
 * LANDING_INDEXABLE=1 на настоящем домене.
 */
export const GET: APIRoute = ({ site }) => {
  const indexable = process.env.LANDING_INDEXABLE === "1";
  const body = indexable
    ? `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap-index.xml", site).href}\n`
    : `User-agent: *\nDisallow: /\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
