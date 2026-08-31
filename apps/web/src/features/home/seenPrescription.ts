/**
 * Какое назначение семья уже видела.
 *
 * Отправки сообщений в продукте нет вовсе (`notify_family` — задача, которой в
 * воркере не существует), и о новом назначении семья узнавала, только заметив
 * изменившиеся числа на главной. Пока канала нет, роль сообщения играет блок на
 * главной — а «прочитано» приходится помнить на устройстве.
 *
 * Устройство, а не учётная запись: серверного признака прочтения в схеме нет,
 * а заводить его ради подсказки — это таблица, миграция и ручка. Цена ошибки
 * мала: в худшем случае родитель увидит блок дважды, на телефоне и на ноутбуке.
 * Доступ обёрнут в try/catch: в приватном окне обращение к хранилищу бросает
 * исключение, и падать из-за подсказки интерфейс не должен.
 */
const STORAGE_KEY = "ketocare:seen-prescription";

export function readSeenPrescription(patientId: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_KEY}:${patientId}`);
  } catch {
    // хранилище недоступно — подсказка просто останется на экране
    return null;
  }
}

export function storeSeenPrescription(
  patientId: string,
  prescriptionId: string,
): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${patientId}`, prescriptionId);
  } catch {
    // не сохранится до перезагрузки — это лучше, чем отказ кнопки
  }
}

/** Сколько дней назначение считается новостью. */
export const NEW_PRESCRIPTION_DAYS = 14;

/**
 * Назначение стоит показать как новость.
 *
 * Два условия, и оба нужны. Непрочитанное — потому что подсказка обязана
 * уходить с экрана, иначе она превращается в часть фона. Свежее — потому что у
 * семей, которые ведут ребёнка не первый месяц, отметки «прочитано» нет ни
 * одной: без ограничения по сроку они все разом увидели бы «врач задал
 * назначение» о назначении полугодовой давности.
 */
export function isNewPrescription(
  createdAt: string,
  seenId: string | null,
  prescriptionId: string,
  now: Date,
): boolean {
  if (seenId === prescriptionId) return false;

  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;

  const days = (now.getTime() - created.getTime()) / (24 * 60 * 60 * 1000);
  return days >= 0 && days <= NEW_PRESCRIPTION_DAYS;
}
