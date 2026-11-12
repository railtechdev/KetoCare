/**
 * Тексты сайта — для невролога, диетолога и родителя, не для разработчика.
 *
 * Прежний сайт говорил «keto_engine», «LP-контроль», «Atwater Checksum»,
 * «2FA», «триаж» и «светофор» на трёх языках, обещал «ранний доступ» и
 * «пилот», а бота и приложение в Telegram ставил в «развитие», хотя ими уже
 * пользовались (docs/AUDIT_PRODUCT_2026-11.md, раздел 1). Список ниже держит
 * эти слова снаружи; новое слово жаргона добавляется сюда же.
 */
import { describe, expect, it } from "vitest";

// Общий список запрещённых слов кабинета, приложения в Telegram, бота и
// сообщений (docs/PLAN_UI_TEXT_2026-11.md, раздел 3): сайт — пятый канал, и
// называть одно и то же иначе, чем продукт, он не должен.
import shared from "../../../ui/src/testing/forbiddenTerms.json";
import { en } from "./en";
import { ru } from "./ru";
import { uz } from "./uz";

const FORBIDDEN = [
  /keto_?engine/i,
  /ядр[оаеу]\b/i,
  /\bLP\b/,
  /линейн\w* программ/i,
  /симплекс/i,
  /atwater|этватер|etvoter/i,
  /\b2FA\b/i,
  /\bGKI\b/i,
  /триаж|triaj|triage/i,
  /светофор|svetofor|traffic light/i,
  /клиническ\w* контур|klinik kontur|clinical loop/i,
  /экосистем|ekotizim|ecosystem/i,
  /mini ?app/i,
  /\bUSDA\b/,
  /\bAPI\b/,
  /\bТЗ\b|техническ\w* задани/i,
  /эталон/i,
  /релиз|release/i,
  /ранн\w* доступ|erta kirish|early access/i,
  /пилот|pilot/i,
  /лист ожидания|waitlist|waiting list/i,
  /код клиники|klinika kodi|clinic code/i,
  /в развитии|coming soon/i,
  /ISO|HIPAA/,
  /PR #|ADR-/,
  /кабинет[а-я]* в браузере|веб-кабинет|web cabinet|brauzerdagi kabinet/i,
  /верси[яиюей]|version|versiya/i,
  // Срок ответа на заявку: уведомления о ней нет, обещать некому.
  /в ближайш|в течение \d|within \d|next few days|yaqin kunlarda/i,
  ...shared.terms.map((term) => new RegExp(term.pattern, term.flags)),
];

function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value))
    return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      strings(v, path ? `${path}.${k}` : k),
    );
  return [];
}

function shape(value: unknown): unknown {
  if (typeof value === "string") return "s";
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shape(v)]),
    );
  return typeof value;
}

describe.each([
  ["ru", ru],
  ["uz", uz],
  ["en", en],
])("словарь %s", (_lang, dict) => {
  it("не говорит языком разработки и не обещает того, чего нет", () => {
    const hits = strings(dict).flatMap(([path, text]) =>
      FORBIDDEN.filter((re) => re.test(text)).map((re) => `${path}: ${re}`),
    );
    expect(hits).toEqual([]);
  });

  it("повторяет русский словарь по форме, включая длину списков", () => {
    // Тип ловит пропущенный ключ, но не пропущенный пункт списка: перевод с
    // четырьмя пунктами вместо пяти проходит проверку типов молча.
    expect(shape(dict)).toEqual(shape(ru));
  });

  it("не оставляет пустых строк", () => {
    const empty = strings(dict).filter(([, text]) => text.trim() === "");
    expect(empty).toEqual([]);
  });
});
