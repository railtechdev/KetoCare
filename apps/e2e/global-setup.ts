import { execFileSync } from "node:child_process";

import { ROOT } from "./src/env";

/**
 * Данные прогона — перед каждым запуском, а не отдельным шагом в памяти
 * человека.
 *
 * Сид не только заводит учётные записи, но и **задаёт второй фактор врача**
 * известным секретом, а врачу настройки — наоборот, снимает его. Забытый сид
 * проявляется как «Неверный код подтверждения» — сообщение, по которому причину
 * не найти.
 */
export default function globalSetup(): void {
  execFileSync("uv", ["run", "python", "infra/scripts/seed_e2e.py"], {
    cwd: ROOT,
    stdio: "inherit",
  });
}
