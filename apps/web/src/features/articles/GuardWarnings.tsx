import { WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { GuardWarning } from "./types";

/**
 * Sentences the assistant's answer filter would stop (ADR-0093).
 *
 * A warning, not a ban: a clinical text may say what the assistant may not
 * repeat, and the specialist decides. The words say what happens to the family
 * — the answer turns into «ask your doctor» — not which rule fired: the rule's
 * name is a developer's word.
 */
export function GuardWarnings({ warnings }: { warnings: GuardWarning[] }) {
  const { t } = useTranslation("articles");
  if (warnings.length === 0) return null;

  return (
    <WarningBanner level="warning" title={t("warnings.title")}>
      <p className="m-0">{t("warnings.description")}</p>
      <ul className="m-0 mt-field flex list-none flex-col gap-field p-0">
        {warnings.map((warning, index) => (
          <li key={index} className="flex flex-col gap-1">
            <span className="font-medium">
              {t(`warnings.kind.${warning.kind}`)}
              {warning.section !== "" && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  {t("warnings.inSection", { section: warning.section })}
                </span>
              )}
            </span>
            {warning.sentence !== "" && (
              <q className="text-muted-foreground">{warning.sentence}</q>
            )}
          </li>
        ))}
      </ul>
    </WarningBanner>
  );
}
