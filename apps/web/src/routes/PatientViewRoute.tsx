import {
  RatioBadge,
  Skeleton,
  cn,
  formatKcal,
  formatMeasured,
  formatOccurredAt,
  formatWeight,
} from "@ketocare/ui";
import { useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../components/PageLayout";
import { SectionLink } from "../components/SectionLink";
import { useSession } from "../features/auth/useSession";
import { PatientViewLink } from "../features/doctor/PatientViewLink";
import { ageInMonths, formatIsoDate } from "../features/doctor/dates";
import {
  PATIENT_VIEW_ICONS,
  PATIENT_VIEW_SCREENS,
  PATIENT_VIEW_WIDTH,
  isPatientView,
  patientViewsFor,
} from "../features/doctor/patientViews";
import { usePatientOverview } from "../features/patients/overview";
import { usePatient } from "../features/patients/usePatient";

/**
 * Открытый раздел карты пациента.
 *
 * Заголовок страницы — название раздела, а не имя пациента: имя стоит в
 * навигации рабочего места и видно в любом разделе, а заголовок обязан
 * отвечать на вопрос «что я сейчас смотрю». Так же устроен кабинет, к которому
 * привыкла клиника (`docs/AUDIT_KDC.md`).
 *
 * Экраны разделов грузятся по требованию (`lazy` в `patientViews.tsx`): в
 * прежней карте все шесть вкладок ехали одним куском вместе с recharts, хотя
 * врач открывал одну.
 */
export function PatientViewRoute() {
  const { t } = useTranslation("doctor");
  const { patientId, view } = useParams({
    from: "/app/patients/$patientId/$view",
  });
  const { session } = useSession();
  const patient = usePatient(patientId);
  const overview = usePatientOverview(patientId);

  // Родительский маршрут не показывает содержимое, пока пациент не загружен,
  // поэтому здесь данные уже в кэше. Проверка — на случай гонки при смене
  // пациента: показать чужой раздел под чужим именем нельзя.
  if (patient.data === undefined) return null;

  // Недопустимое значение уводит `beforeLoad`; сюда оно не доходит, но экран
  // обязан быть верен и сам по себе — иначе правка маршрута молча превратит
  // его в пустую страницу.
  if (!isPatientView(view)) return null;

  const months = patient.data.birth_date
    ? ageInMonths(patient.data.birth_date, new Date())
    : null;
  const prescription = overview.data?.prescription ?? null;
  const lastWeight = overview.data?.last_weight ?? null;
  const views = patientViewsFor(session?.role);

  return (
    <PageLayout
      title={t(`workspace.views.${view}`)}
      // Ширина — роль раздела, а не одно число на всю карту (правило П34):
      // дневники сравнивают ряды, сводку читают.
      width={PATIENT_VIEW_WIDTH[view]}
      // Плотность объявляется один раз на экран и наследуется блоками
      // (правило П26 канона).
      density="compact"
    >
      {/* Закреплённая клиническая шапка (Sticky Patient Header) */}
      <div
        className="sticky top-0 z-20 -mx-1 -mt-2 mb-section flex flex-col gap-3 rounded-xl border border-border bg-card p-section shadow-kc-sm"
        aria-label={t("workspace.patientBanner", {
          name: patient.data.full_name,
        })}
      >
        <div className="flex flex-wrap items-center justify-between gap-field">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2 className="m-0 break-words text-title font-bold tracking-tight text-foreground">
                {patient.data.full_name}
              </h2>
              {months !== null && (
                <span className="tabular-nums text-xs font-medium text-muted-foreground sm:text-sm">
                  {months < 24
                    ? t("age.months", { count: months })
                    : t("age.years", { count: Math.floor(months / 12) })}
                  {patient.data.birth_date &&
                    ` · ${formatIsoDate(patient.data.birth_date)}`}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {lastWeight !== null && (
                <span className="tabular-nums font-medium text-foreground">
                  {t("summary.readings.weightValue", {
                    value: formatWeight(lastWeight.weight_kg),
                    at: formatOccurredAt(new Date(lastWeight.occurred_at)),
                  })}
                </span>
              )}
              {patient.data.height_cm !== null &&
                patient.data.height_cm !== undefined && (
                  <span className="tabular-nums">
                    {t("workspace.heightValue", {
                      value: formatMeasured(patient.data.height_cm),
                    })}
                  </span>
                )}
              {prescription !== null && (
                <>
                  <RatioBadge ratio={prescription.ratio} />
                  <span className="tabular-nums font-medium text-foreground">
                    {t("list.kcalValue", {
                      value: formatKcal(prescription.kcal_per_day),
                    })}
                  </span>
                </>
              )}
            </div>
          </div>
          <SectionLink
            section="patients"
            exact
            className="inline-flex min-h-touch items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground sm:text-sm"
          >
            <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
            {t("workspace.toList")}
          </SectionLink>
        </div>

        {/* Навигация по вкладкам карточки пациента с горизонтальным скроллом без обрезания 6-й и 7-й вкладок */}
        <div
          role="tablist"
          aria-label={t("workspace.navLabel", { name: patient.data.full_name })}
          className="flex w-full items-center gap-1 overflow-x-auto border-t border-border/70 pt-2 pb-0.5 scrollbar-none [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"
        >
          {views.map((v) => {
            const Icon = PATIENT_VIEW_ICONS[v];
            const isCurrent = v === view;
            return (
              <PatientViewLink
                key={v}
                patientId={patient.data.id}
                view={v}
                current={isCurrent}
                className={cn(
                  "inline-flex min-h-touch shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors no-underline sm:text-sm",
                  isCurrent
                    ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span>{t(`workspace.views.${v}`)}</span>
              </PatientViewLink>
            );
          })}
        </div>
      </div>
      {/* Ключ — пациент. Переключатель в шапке карты меняет пациента в адресе,
          а раздел оставляет, и без ключа React сохранял экран раздела вместе с
          его состоянием: калькулятор держал цель и состав прежнего ребёнка, и
          вердикт «в допуске» выносился против чужого назначения. Цена ключа —
          вместе с ним сбрасывается всё, что раздел держит в состоянии, а не в
          адресе: выбранные периоды дневника и отчёта, открытая и не
          сохранённая форма. Параметры адреса к другому пациенту тоже не
          переходят — переключатель ведёт на раздел без них. */}
      <Suspense key={patient.data.id} fallback={<ViewSkeleton />}>
        {PATIENT_VIEW_SCREENS[view](patient.data, session?.role)}
      </Suspense>
    </PageLayout>
  );
}

function ViewSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("states.loadingSection")}
      className="flex flex-col gap-section"
    >
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}
