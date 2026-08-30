/** Фильтры журнала аудита (раздел 8.3 ТЗ: журнал только читается). */
export interface AuditFilters {
  /** Идентификатор автора действия; пустая строка — фильтр не задан */
  userId: string;
  entity: string;
  action: string;
  /** Границы периода как `YYYY-MM-DD`, обе включительно */
  from: string;
  to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  userId: "",
  entity: "",
  action: "",
  from: "",
  to: "",
};

/** Размер страницы журнала: он длинный, и листается он с сервера. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * Значения `audit_log.entity`, которые пишет API (apps/api/src/api).
 *
 * Список нужен фильтру: свободный ввод имени таблицы даёт пустую выдачу при
 * первой же опечатке. Незнакомое значение из ответа всё равно показывается —
 * подпись подставляется по ключу, а при его отсутствии остаётся как есть.
 */
export const AUDIT_ENTITIES = [
  "users",
  "invitations",
  "products",
  "recipes",
  "prescriptions",
  "medical_profiles",
  "medications",
  "seizure_types",
  "ketone_methods",
  "patients",
  "doctor_patient",
  "reports",
  "telegram_accounts",
  "link_codes",
] as const;

/** Значения `audit_log.action`, которые пишет API. */
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "publish",
  "import",
  "invite",
  "accept_invitation",
  "login",
  "login_failed",
  "login_failed_totp",
  "totp_setup_requested",
  "totp_enabled",
  "totp_reset",
  "login_with_backup_code",
  "backup_codes_regenerated",
  "password_changed",
  "password_change_failed",
  "export",
  "grant_patient_access",
  "revoke_patient_access",
  "telegram_link_code_issued",
  "telegram_link",
  "telegram_unlink",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

/** Введён идентификатор, который сервер отклонит как невалидный UUID. */
export function isUserIdInvalid(filters: AuditFilters): boolean {
  const value = filters.userId.trim();
  return value !== "" && !isUuid(value);
}

export function isRangeInvalid(filters: AuditFilters): boolean {
  return filters.from !== "" && filters.to !== "" && filters.from > filters.to;
}

/**
 * Границы периода уходят на сервер как момент времени с зоной, а не как дата.
 *
 * `audit_log.created_at` хранится с временной зоной, а администратор задаёт
 * отрезок в своей: без явного перевода запись, сделанная вечером 1-го числа,
 * попадала бы в выдачу за 2-е (или выпадала из неё) в зависимости от смещения.
 */
export function startOfDayIso(date: string): string | undefined {
  return toIso(date, "T00:00:00.000");
}

export function endOfDayIso(date: string): string | undefined {
  return toIso(date, "T23:59:59.999");
}

function toIso(date: string, time: string): string | undefined {
  if (date === "") return undefined;

  // Строка без суффикса зоны разбирается как местное время — именно это и нужно.
  const parsed = new Date(`${date}${time}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Фильтры экрана — в параметры запроса `GET /admin/audit-log`. */
export function toAuditQuery(
  filters: AuditFilters,
  offset: number,
  limit: number = AUDIT_PAGE_SIZE,
) {
  const userId = filters.userId.trim();

  return {
    user_id: userId === "" ? undefined : userId,
    entity: filters.entity === "" ? undefined : filters.entity,
    action: filters.action === "" ? undefined : filters.action,
    from: startOfDayIso(filters.from),
    to: endOfDayIso(filters.to),
    limit,
    offset,
  };
}
