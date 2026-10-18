import {
  RatioBadge,
  WorkspaceNav,
  cn,
  formatKcal,
  formatOccurredAt,
  formatWeight,
} from "@ketocare/ui";
import { useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import type { Role } from "../auth/roles";
import { PatientViewLink } from "./PatientViewLink";
import { ageInMonths } from "./dates";
import {
  PATIENT_VIEW_ICONS,
  isPatientView,
  patientViewsFor,
  type PatientView,
} from "./patientViews";
import type { Patient, PatientOverview } from "./types";

const GROUP_START_VIEWS: ReadonlySet<PatientView> = new Set([
  "diary",
  "notes",
  "profile",
]);

/**
 * Навигация по карте пациента.
 *
 * Заголовок называет, чью карту читает врач, и делает это в каждом разделе. Это
 * не украшение: паспорт пациента раньше стоял над вкладками и потому был виден
 * всегда, и, разложив вкладки по адресам, ответ на вопрос «чьи это данные»
 * легко было потерять совсем. Возраст рядом с именем по той же причине: два
 * ребёнка с одной фамилией в когорте — обычное дело.
 *
 * Возврат к списку — здесь, а не кнопкой «Назад» в шапке страницы: заголовок
 * страницы занят названием раздела, и возврат над ним читался бы как «выйти из
 * раздела», хотя выводит он из карты целиком.
 */
export function PatientNav({
  patient,
  role,
  overview = null,
}: {
  patient: Patient;
  role: Role | undefined;
  overview?: PatientOverview | null;
}) {
  const { t } = useTranslation("doctor");
  const months = ageInMonths(patient.birth_date, new Date());

  // Открытый раздел берётся из адреса, а не из состояния: адрес и есть ответ
  // на вопрос «что открыто». Маршрут не назван (`strict: false`), потому что
  // навигацию рисует родительский маршрут: на адресе без раздела
  // (`/app/patients/<id>`, ведёт на сводку) дочернего совпадения ещё нет, и
  // привязка к нему уронила бы навигацию в момент перехода.
  const { view } = useParams({ strict: false });
  const current = view !== undefined && isPatientView(view) ? view : null;

  const prescription = overview?.prescription ?? null;
  const lastWeight = overview?.last_weight ?? null;
  const allergyLabels = patient.allergy_labels ?? [];
  const hasClinicalSummary =
    prescription !== null || lastWeight !== null || allergyLabels.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-field lg:flex-col lg:items-stretch">
        <SectionLink
          section="patients"
          exact
          className="-ml-2 flex min-h-touch items-center gap-field self-start rounded-lg px-2 text-sm text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          {t("workspace.toList")}
        </SectionLink>

        {/* Заголовок второго уровня: первый занят названием раздела, а имя
            пациента — подпись ко всей навигации, а не второй заголовок
            страницы (правило П24 канона). */}
        <div className="flex flex-col gap-1.5 rounded-xl border border-border/80 bg-card px-3 py-2.5 shadow-kc-sm">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="m-0 text-card-title font-semibold break-words text-foreground">
              {patient.full_name}
            </h2>
            {months !== null && (
              <p className="m-0 text-xs font-medium text-muted-foreground">
                {months < 24
                  ? t("age.months", { count: months })
                  : t("age.years", { count: Math.floor(months / 12) })}
              </p>
            )}
          </div>

          {hasClinicalSummary && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-1.5 text-xs text-muted-foreground">
              {prescription !== null && (
                <>
                  <RatioBadge ratio={prescription.ratio} />
                  <span className="font-medium text-foreground tabular-nums">
                    {t("list.kcalValue", {
                      value: formatKcal(prescription.kcal_per_day),
                    })}
                  </span>
                </>
              )}
              {lastWeight !== null && (
                <span className="tabular-nums">
                  {t("summary.readings.weightValue", {
                    value: formatWeight(lastWeight.weight_kg),
                    at: formatOccurredAt(new Date(lastWeight.occurred_at)),
                  })}
                </span>
              )}
              {allergyLabels.length > 0 && (
                <span className="rounded-md bg-warning-subtle px-1.5 py-0.5 font-medium text-warning-strong">
                  {allergyLabels.join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <WorkspaceNav>
        {patientViewsFor(role).map((viewItem) => {
          const Icon = PATIENT_VIEW_ICONS[viewItem];
          const open = viewItem === current;
          const startsNewGroup = GROUP_START_VIEWS.has(viewItem);

          return (
            <li
              key={viewItem}
              className={cn(
                startsNewGroup &&
                  "lg:mt-1.5 lg:border-t lg:border-border/60 lg:pt-1.5",
              )}
            >
              <PatientViewLink
                patientId={patient.id}
                view={viewItem}
                current={open}
                className={cn(
                  "flex min-h-touch items-center gap-field rounded-lg px-2.5 text-xs font-medium sm:text-sm lg:min-h-9 lg:px-3",
                  "no-underline transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  open
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "text-foreground/80",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className="hidden size-4 shrink-0 lg:block"
                />
                {t(`workspace.views.${viewItem}`)}
              </PatientViewLink>
            </li>
          );
        })}
      </WorkspaceNav>
    </>
  );
}
