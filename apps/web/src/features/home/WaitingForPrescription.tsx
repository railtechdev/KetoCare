import { Section } from "@ketocare/ui";
import { Baby, NotebookPen, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";

/**
 * Что делать семье, пока врач не задал назначение.
 *
 * Между «завёл ребёнка» и «врач задал назначение» главная показывала три
 * пустых блока подряд и ни одной подсказки: ближайший приём пищи — пусто,
 * итоги дня — пусто, назначение — «его задаёт врач». Родитель в этот момент
 * только что прошёл регистрацию по приглашению и не знает ни того, чего ждёт,
 * ни того, что дневники уже работают.
 *
 * Блок отвечает на оба вопроса разом: чего ждём от врача и что уже можно
 * делать. Обещать здесь нечего сверх существующего — каждая строка ведёт на
 * работающий экран (правило П3 канона).
 */
const STEPS = [
  // Анкета и документы открываются сразу на своём подэкране раздела
  // «Ребёнок» (`?tab=` + `?item=<ребёнок>`). Прежде ссылки вели на список
  // детей, и родитель искал там, где анкета, — то есть ссылка обещала шаг,
  // а приводила к поиску.
  {
    key: "intake",
    icon: Baby,
    section: "child",
    tab: "intake",
    diaryKind: undefined,
  },
  {
    key: "documents",
    icon: Paperclip,
    section: "child",
    tab: "documents",
    diaryKind: undefined,
  },
  {
    key: "diary",
    icon: NotebookPen,
    section: "diary",
    tab: undefined,
    diaryKind: "ketones",
  },
] as const;

export function WaitingForPrescription({ patientId }: { patientId: string }) {
  const { t } = useTranslation("home");

  return (
    <Section
      title={t("waiting.title")}
      description={t("waiting.intro")}
      density="compact"
    >
      <ul className="m-0 flex list-none flex-col gap-field p-0">
        {STEPS.map(({ key, icon: Icon, section, tab, diaryKind }) => (
          <li key={key} className="flex items-start gap-field">
            <Icon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <span>
              <SectionLink
                section={section}
                tab={tab}
                item={tab === undefined ? undefined : patientId}
                diaryKind={diaryKind}
                className="font-medium underline-offset-2 hover:underline"
              >
                {t(`waiting.steps.${key}.link`)}
              </SectionLink>{" "}
              <span className="text-muted-foreground">
                {t(`waiting.steps.${key}.hint`)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
