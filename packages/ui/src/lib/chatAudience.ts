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

/** Which roles the one-line audience note names. */
export type ChatAudienceRoles = "both" | "doctor" | "dietitian";

/**
 * The roles that actually lead the child — for the short line «Вопросы видят
 * врач и диетолог» (decision Р1 of the Mini App audit 2026-11).
 *
 * Until the list arrives, when it does not arrive, or when it names nobody of
 * the two roles, both are named: saying less than the server allows would make
 * the warning weaker than the right it warns about.
 */
export function chatAudienceRoles(
  readers: readonly ChatReader[] | undefined,
): ChatAudienceRoles {
  const doctor = readers?.some((reader) => reader.role === "doctor") ?? false;
  const dietitian =
    readers?.some((reader) => reader.role === "dietitian") ?? false;
  if (doctor && !dietitian) return "doctor";
  if (dietitian && !doctor) return "dietitian";
  return "both";
}

/**
 * `tel:` address of a phone number typed by the administrator
 * («+998 71 123-45-67» → `tel:+998711234567`). `null` — nothing to dial.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined) return null;
  const digits = phone.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return /\d{3,}/.test(digits) ? `tel:${digits}` : null;
}
