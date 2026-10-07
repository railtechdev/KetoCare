import { Button, WarningBanner } from "@ketocare/ui";
import { useState } from "react";
import { copyText } from "../../lib/clipboard";
import { useTranslation } from "react-i18next";

/**
 * Показ резервных кодов — один раз и только один.
 *
 * В базе лежит только sha256, повторить показ невозможно. Поэтому экран не
 * уходит сам: пока человек не подтвердил, что сохранил коды, ему не дают
 * пройти дальше. Иначе набор, выданный ради восстановления доступа, теряется в
 * тот же момент, когда выдаётся.
 *
 * Кнопки «скачать файл» нет намеренно: файл с кодами оседает в загрузках и
 * попадает в облачную синхронизацию вместе с остальной папкой. Коды переписывают
 * на бумагу или кладут в менеджер паролей — так их и просят сохранить.
 */
export function BackupCodesPanel({
  codes,
  onDone,
  doneLabel,
}: {
  codes: readonly string[];
  onDone: () => void;
  doneLabel: string;
}) {
  const { t } = useTranslation("auth");
  // Ответ строкой рядом с кнопкой, а не тостом: панель показывается и при
  // настройке второго фактора на экране входа, где тостов нет вовсе.
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <div className="flex flex-col gap-section">
      {/* Заголовок баннера — предупреждение, а не повтор названия экрана:
          два одинаковых заголовка подряд читаются как сбой вёрстки. */}
      <WarningBanner level="warning" title={t("backupCodes.warningTitle")}>
        {t("backupCodes.intro")}
      </WarningBanner>

      <ul className="m-0 grid list-none grid-cols-2 gap-field p-0">
        {codes.map((code) => (
          <li
            key={code}
            className="rounded-lg border border-border px-3 py-2 text-center font-mono tracking-wider tabular-nums"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-field">
        <Button
          type="button"
          variant="outline"
          className="min-h-touch"
          onClick={() =>
            void copyText(codes.join("\n")).then((ok) =>
              setCopy(ok ? "copied" : "failed"),
            )
          }
        >
          {t("backupCodes.copy")}
        </Button>
        <Button type="button" className="min-h-touch" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
      <p
        role="status"
        className={
          copy === "failed"
            ? "m-0 text-sm text-destructive"
            : "m-0 text-sm text-muted-foreground"
        }
      >
        {copy === "idle" ? null : t(`common:clipboard.${copy}`)}
      </p>
    </div>
  );
}
