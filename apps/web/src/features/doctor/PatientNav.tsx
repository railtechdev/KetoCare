import { WorkspaceNav, cn } from "@ketocare/ui";
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
} from "./patientViews";
import type { Patient } from "./types";

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
}: {
  patient: Patient;
  role: Role | undefined;
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

  return (
    <>
      <div className="flex flex-col gap-field">
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
        <div className="px-2">
          <h2 className="m-0 text-card-title font-semibold break-words text-foreground">
            {patient.full_name}
          </h2>
          {months !== null && (
            <p className="m-0 text-sm text-muted-foreground">
              {months < 24
                ? t("age.months", { count: months })
                : t("age.years", { count: Math.floor(months / 12) })}
            </p>
          )}
        </div>
      </div>

      <WorkspaceNav>
        {patientViewsFor(role).map((view) => {
          const Icon = PATIENT_VIEW_ICONS[view];
          const open = view === current;

          return (
            <li key={view}>
              <PatientViewLink
                patientId={patient.id}
                view={view}
                current={open}
                className={cn(
                  "flex min-h-touch items-center gap-field rounded-lg px-3 text-sm font-medium",
                  "no-underline transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  open
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "text-foreground/80",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {t(`workspace.views.${view}`)}
              </PatientViewLink>
            </li>
          );
        })}
      </WorkspaceNav>
    </>
  );
}
