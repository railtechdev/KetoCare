import { WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import { useClinicalReviewCount } from "./useClinicalArticles";

/**
 * «Статьи для семей ждут вашей проверки: N» — where the specialist already
 * works (the patient list), not only inside the articles section.
 *
 * Four eyes only work if the second pair is told: a doctor whose day starts
 * and ends in the patient list never opened the articles section and never
 * learned that a colleague's article was waiting. Nothing is shown while the
 * count is zero, unknown or failed — the list is the page, this is a note.
 */
export function ArticlesAwaitingReview() {
  const { t } = useTranslation("articles");
  const count = useClinicalReviewCount();
  const waiting = typeof count.data === "number" ? count.data : 0;
  if (waiting === 0) return null;

  return (
    <WarningBanner
      level="info"
      title={t("awaiting.banner", { number: waiting })}
    >
      <SectionLink
        section="articles"
        tab="review"
        className="font-medium underline underline-offset-4"
      >
        {t("awaiting.open")}
      </SectionLink>
    </WarningBanner>
  );
}
