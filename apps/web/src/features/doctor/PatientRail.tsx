import { Section } from "@ketocare/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import { cn } from "@ketocare/ui";
import { usePatients } from "../patients/usePatients";
import { PatientFlagsView } from "./PatientFlagsView";
import { usePatientOverviews } from "./doctorQueries";
import { attentionRank, computePatientFlags } from "./flags";

/**
 * Перечень пациентов рядом с открытой картой (широкий экран, `SplitView`).
 *
 * Это НЕ второй список пациентов: полного реестра со столбцами, отбором и
 * приглашением здесь нет, и подменять его этот перечень не должен. Он отвечает
 * на единственный вопрос, который возникает, когда карта уже открыта: «кто
 * следующий». До него ответ на него стоил двух переходов — «Назад» к реестру и
 * снова в карту, — и на широком мониторе они делались рядом с 488 px пустоты.
 *
 * Порядок — тот же триаж, что на главной врача (правило П19 канона): сначала
 * помеченные, дальше по алфавиту. Список, отсортированный по алфавиту, ставил
 * бы первым того, кто просто начинается на «А».
 *
 * Заголовок уровня блока, а не экрана: заголовок экрана занят именем открытого
 * пациента (правило П24 канона). Данные берутся из общего кэша — те же запросы,
 * что у реестра и у главной, поэтому перечень не стоит ни одного лишнего
 * обращения к серверу.
 */
export function PatientRail({ selectedId }: { selectedId: string }) {
  const { t } = useTranslation("doctor");
  const patients = usePatients();
  const items = useMemo(() => patients.data?.items ?? [], [patients.data]);
  const overviews = usePatientOverviews(
    useMemo(() => items.map((patient) => patient.id), [items]),
  );

  const rows = useMemo(() => {
    return items
      .map((patient) => {
        const flags = computePatientFlags(
          overviews.byPatientId.get(patient.id) ?? null,
        );
        return {
          patient,
          flags,
          rank: flags === null ? 0 : attentionRank(flags),
        };
      })
      .sort(
        (a, b) =>
          b.rank - a.rank ||
          a.patient.full_name.localeCompare(b.patient.full_name, "ru-RU"),
      );
  }, [items, overviews.byPatientId]);

  return (
    <Section
      title={t("rail.title")}
      density="compact"
      contentClassName="gap-field"
    >
      <ul className="m-0 flex max-h-[60dvh] list-none flex-col gap-1 overflow-y-auto p-0">
        {rows.map((row) => {
          const current = row.patient.id === selectedId;

          return (
            <li key={row.patient.id}>
              <SectionLink
                section="patients"
                patient={row.patient.id}
                className={cn(
                  "flex min-h-touch flex-wrap items-center gap-field rounded-lg px-3 py-2 text-sm",
                  "no-underline transition-colors hover:bg-accent",
                  current
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "text-foreground",
                )}
                // Открытый пациент помечен не только цветом: цвет — не
                // единственный признак (WCAG 1.4.1), и в списке из двадцати имён
                // подсветка строки читается хуже, чем сказанное вслух.
                current={current}
              >
                <span className="min-w-0 flex-1 break-words">
                  {row.patient.full_name}
                </span>
                {row.flags !== null && <PatientFlagsView flags={row.flags} />}
              </SectionLink>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
