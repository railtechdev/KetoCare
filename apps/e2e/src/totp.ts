import { createHmac } from "node:crypto";

/**
 * Одноразовый код по RFC 6238 (TOTP, SHA-1, 6 цифр, шаг 30 с).
 *
 * Своя реализация, а не библиотека: тридцать строк против новой зависимости в
 * дереве, которую пришлось бы обосновывать (раздел 16 ТЗ). Алгоритм за
 * двенадцать лет не менялся, а сервер использует ровно эти параметры —
 * `pyotp.TOTP(secret)` по умолчанию.
 */
export function totp(secret: string, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", base32Decode(secret))
    .update(message)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let accumulator = 0;

  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error(`Не base32: ${character}`);
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}
