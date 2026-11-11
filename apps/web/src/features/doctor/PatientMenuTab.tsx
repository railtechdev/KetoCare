import { useTranslation } from "react-i18next";

import { SubPageHeader } from "../../components/SubPageHeader";
import { DayComposer } from "../menu/DayComposer";
import { WeekGrid } from "../menu/WeekGrid";
import { formatDayLabel, todayIso } from "../menu/dates";
import { useAddressState } from "../../routes/useSectionTab";

/**
 * План питания пациента у специалиста — составляется здесь же (ADR-0047).
 *
 * До решения заказчика G2 (05.10.2026) раздел был только на чтение: «меню
 * составляет семья». Но семьи с низкой цифровой грамотностью не справлялись с
 * тем, чтобы собрать день в соотношение, а диетолог, умеющий это, мог только
 * смотреть. Теперь врач и диетолог собирают день тем же экраном, что и семья, —
 * `DayComposer`, а не копией: сервер хранит те же правила для всех (съеденное
 * не стирается, совпавшие позиции сохраняют отметки), и экран показывает день
 * одинаково обеим сторонам.
 *
 * Два отличия от экрана семьи, оба про ответственность, а не про вид:
 * - отметку «съедено» специалист не ставит — это запись семьи о том, что
 *   ребёнок ел, и он её только видит;
 * - сохранение специалистом сервер подписывает его именем и пишет семье в
 *   Telegram: план, по которому кормят ребёнка, поменял другой человек.
 *
 * Блюда ребёнка — отдельный раздел карты, в день они попадают через выбор блюда.
 */
const DAY_ANCHOR = "patient-menu-day";

export function PatientMenuTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const address = useAddressState();

  return (
    <div className="flex flex-col gap-section">
      <WeekGrid patientId={patientId} dayAnchorId={DAY_ANCHOR} />

      <DayComposer patientId={patientId} canMarkEaten={false}>
        {({ actions, content }) => (
          <div
            id={DAY_ANCHOR}
            className="flex scroll-mt-4 flex-col gap-section"
          >
            {/* Заголовок страницы — раздел карты («Питание»); действиям над днём
                нужно своё место, и оно — шапка содержимого. */}
            <SubPageHeader
              title={t("menu.dayTitle", {
                date: formatDayLabel(address.date ?? todayIso()),
              })}
              intro={t("menu.intro")}
              actions={actions}
            />
            {content}
          </div>
        )}
      </DayComposer>
    </div>
  );
}
