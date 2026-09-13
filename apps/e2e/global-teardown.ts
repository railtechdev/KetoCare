import { rmSync } from "node:fs";

import { doctorSecretFile } from "./src/auth";

/**
 * Секрет второго фактора врача не переживает прогон.
 *
 * Он нужен только между попытками одного прогона (Playwright перезапускает
 * воркер после падения), а на машине разработчика файл иначе остался бы
 * навсегда — с действующим секретом сидовой учётки.
 */
export default function globalTeardown(): void {
  rmSync(doctorSecretFile(), { force: true });
}
