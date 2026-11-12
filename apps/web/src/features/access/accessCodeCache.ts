import type { AccessCodeCreated, AccessCodePurpose } from "./useAccessCodes";

/**
 * Последний код, выпущенный панелью в этой вкладке, — чтобы повторное открытие
 * панели показывало его, а не выпускало ещё один.
 *
 * Каждый код действует неделю, и врач, открывший панель пять раз, оставлял бы
 * пять живых дверей к данным ребёнка. Хранилище вкладки, а не браузера:
 * код — не настройка, и переживать закрытие вкладки ему незачем.
 *
 * Хранилище — только подсказка: показать код можно, лишь если журнал сервера
 * подтверждает, что он ещё действует (не погашен и не отозван). Хранилище бывает
 * недоступно (приватный режим, запрет сайта) — тогда каждое чтение отвечает
 * «ничего нет», а запись молча пропускается: панель просто выпустит код.
 */
function cacheKey(patientId: string, purpose: AccessCodePurpose): string {
  return `ketocare:access-code:${patientId}:${purpose}`;
}

export function readCachedCode(
  patientId: string,
  purpose: AccessCodePurpose,
  now: Date = new Date(),
): AccessCodeCreated | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(cacheKey(patientId, purpose));
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<AccessCodeCreated>;
    if (
      typeof value.code !== "string" ||
      typeof value.expires_at !== "string" ||
      typeof value.join_url !== "string"
    ) {
      return null;
    }
    const expires = Date.parse(value.expires_at);
    if (Number.isNaN(expires) || expires <= now.getTime()) return null;
    return {
      code: value.code,
      expires_at: value.expires_at,
      join_url: value.join_url,
      deep_link: typeof value.deep_link === "string" ? value.deep_link : null,
    };
  } catch {
    return null;
  }
}

export function writeCachedCode(
  patientId: string,
  purpose: AccessCodePurpose,
  created: AccessCodeCreated,
): void {
  try {
    window.sessionStorage.setItem(
      cacheKey(patientId, purpose),
      JSON.stringify(created),
    );
  } catch {
    // Хранилище недоступно — в следующий раз панель выпустит новый код.
  }
}

export function clearCachedCode(
  patientId: string,
  purpose: AccessCodePurpose,
): void {
  try {
    window.sessionStorage.removeItem(cacheKey(patientId, purpose));
  } catch {
    // Нечего очищать.
  }
}
