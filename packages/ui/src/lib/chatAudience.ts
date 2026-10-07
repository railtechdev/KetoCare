/** Специалист, ведущий ребёнка, — как его отдаёт `GET /patients/{id}/doctors`. */
export interface ChatReader {
  full_name: string;
  role: string;
}

/**
 * Кто читает переписку семьи с помощником — перечнем «имя (роль)».
 *
 * Переписку читают ведущие ребёнка врач и диетолог (ADR-0022), и семья об этом
 * предупреждается под полем вопроса. Имена берутся из той же ручки, по которой
 * сервер и пускает специалиста к переписке, поэтому перечень совпадает с
 * правом, а не с представлением экрана о нём.
 *
 * `null` — имён нет (список ещё не пришёл, не пришёл вовсе или пуст): экран
 * говорит о ролях, а не печатает пустой перечень. Одна функция на кабинет и
 * Mini App: перечень, собранный в каждом по-своему, разошёлся бы в первой же
 * правке.
 */
export function chatReadersList(
  readers: readonly ChatReader[] | undefined,
  roleLabel: (role: string) => string,
  locale: string,
): string | null {
  if (!readers || readers.length === 0) return null;
  const names = readers.map(
    (reader) => `${reader.full_name} (${roleLabel(reader.role)})`,
  );
  return new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(names);
}
