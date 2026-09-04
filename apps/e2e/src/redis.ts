import { connect } from "node:net";

import { REDIS_DB, REDIS_HOST, REDIS_PORT } from "./env";

/**
 * Обнулить счётчики ограничителя частоты перед файлом тестов.
 *
 * Нужно из-за настоящего ограничения раздела 11 ТЗ: `/auth/*` — пять запросов в
 * минуту на адрес. Все тесты приходят с одного адреса, и уже второй файл
 * упирался бы в 429: прогон падал бы не на дефекте, а на защите, которая
 * работает как задумано.
 *
 * Ослаблять ограничение переменной окружения нельзя — такой ключ однажды
 * окажется включённым на стенде. Поэтому счётчики просто стираются, и **только
 * они**: ключи `LIMITS:LIMITER*`, которые заводит slowapi поверх библиотеки
 * `limits`. Очередь задач (`arq:*`) лежит в той же базе, и `FLUSHDB` уносил бы
 * вместе со счётчиками чужую работу.
 *
 * Клиент — сырой RESP: ради двух команд заводить зависимость незачем
 * (раздел 16 ТЗ). Удаление одним `EVAL`, чтобы не городить цикл `SCAN`.
 */
const DELETE_LIMITER_KEYS =
  "for _,k in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', k) end return 1";

export function flushRateLimits(): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      { host: REDIS_HOST, port: Number(REDIS_PORT) },
      () => {
        socket.write(command(["SELECT", REDIS_DB]));
        socket.write(command(["EVAL", DELETE_LIMITER_KEYS, "0", "*LIMITER*"]));
      },
    );

    let replies = 0;
    socket.on("data", (chunk) => {
      // Два ответа — на SELECT и на EVAL. Считаем строки, а не разбираем RESP:
      // содержимое ответов здесь не нужно, нужен факт их прихода.
      replies += chunk.toString().split("\r\n").filter(Boolean).length;
      if (replies >= 2) {
        socket.end();
        resolve();
      }
    });
    socket.on("error", reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("Redis не ответил за 5 с — поднят ли он? (make dev)"));
    });
  });
}

function command(parts: string[]): string {
  const head = `*${parts.length}\r\n`;
  return (
    head +
    parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")
  );
}
