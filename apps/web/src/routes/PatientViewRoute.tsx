import { Skeleton } from "@ketocare/ui";
import { useParams } from "@tanstack/react-router";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../components/PageLayout";
import { useSession } from "../features/auth/useSession";
import {
  PATIENT_VIEW_SCREENS,
  PATIENT_VIEW_WIDTH,
  groupOfView,
  groupViewsFor,
  isPatientView,
} from "../features/doctor/patientViews";
import { FamilyPrintButton } from "../features/doctor/FamilyPrintButton";
import { PatientViewLink } from "../features/doctor/PatientViewLink";
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

  // Родительский маршрут не показывает содержимое, пока пациент не загружен,
  // поэтому здесь данные уже в кэше. Проверка — на случай гонки при смене
  // пациента: показать чужой раздел под чужим именем нельзя.
  if (patient.data === undefined) return null;

  // Недопустимое значение уводит `beforeLoad`; сюда оно не доходит, но экран
  // обязан быть верен и сам по себе — иначе правка маршрута молча превратит
  // его в пустую страницу.
  if (!isPatientView(view)) return null;

  const group = groupOfView(view);
  const siblings = groupViewsFor(group, session?.role);

  return (
    <PageLayout
      title={t("workspace.pageTitle", {
        name: patient.data.full_name,
        view: t(`workspace.groupNames.${group}`),
      })}
      // Ширина — роль раздела, а не одно число на всю карту (правило П34):
      // дневники сравнивают ряды, сводку читают.
      width={PATIENT_VIEW_WIDTH[view]}
      // Плотность объявляется один раз на экран и наследуется блоками
      // (правило П26 канона).
      density="compact"
      actions={<FamilyPrintButton patientId={patient.data.id} />}
    >
      {/* Ключ — пациент. Переключатель в шапке карты меняет пациента в адресе,
          а раздел оставляет, и без ключа React сохранял экран раздела вместе с
          его состоянием: калькулятор держал цель и состав прежнего ребёнка, и
          вердикт «в допуске» выносился против чужого назначения. Цена ключа —
          вместе с ним сбрасывается всё, что раздел держит в состоянии, а не в
          адресе: выбранные периоды дневника и отчёта, открытая и не
          сохранённая форма. Параметры адреса к другому пациенту тоже не
          переходят — переключатель ведёт на раздел без них. */}
      {siblings.length > 1 && (
        <nav aria-label={t(`workspace.groupNames.${group}`)}>
          <ul className="m-0 flex list-none flex-wrap gap-1 border-b border-border p-0">
            {siblings.map((sibling) => (
              <li key={sibling}>
                <PatientViewLink
                  patientId={patient.data.id}
                  view={sibling}
                  current={sibling === view}
                  className={
                    sibling === view
                      ? "-mb-px flex min-h-touch items-center border-b-2 border-primary px-4 text-sm font-semibold text-foreground no-underline"
                      : "-mb-px flex min-h-touch items-center border-b-2 border-transparent px-4 text-sm text-muted-foreground no-underline hover:text-foreground"
                  }
                >
                  {t(`workspace.views.${sibling}`)}
                </PatientViewLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
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
