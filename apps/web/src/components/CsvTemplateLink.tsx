import type { ReactNode } from "react";

/**
 * Ссылка на шаблон файла загрузки — строка заголовков и больше ничего.
 *
 * Имена колонок — формат файла, а не текст для человека: в подсказке поля их
 * больше нет («Заполните шаблон», аудит 12.11.2026), и шаблон — единственное
 * место, где человек их видит. Файл собирается на месте, без запроса: шаблон
 * не должен зависеть от того, доступен ли каталог `docs/import` на стенде.
 */
export function CsvTemplateLink({
  columns,
  fileName,
  children,
}: {
  columns: readonly string[];
  fileName: string;
  children: ReactNode;
}) {
  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(
    `${columns.join(",")}\n`,
  )}`;

  return (
    <a href={href} download={fileName} className="font-medium underline">
      {children}
    </a>
  );
}
