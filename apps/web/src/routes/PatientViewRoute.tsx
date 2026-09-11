import { Skeleton } from "@ketocare/ui";
import { useParams } from "@tanstack/react-router";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../components/PageLayout";
import { useSession } from "../features/auth/useSession";
import {
  PATIENT_VIEW_SCREENS,
  PATIENT_VIEW_WIDTH,
  isPatientView,
} from "../features/doctor/patientViews";
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
      {/* Ключ — пациент. Переключатель в шапке карты меняет пациента в адресе,
          а раздел оставляет, и без ключа React сохранял экран раздела вместе с
          его состоянием: калькулятор держал цель и состав прежнего ребёнка, и
          вердикт «в допуске» выносился против чужого назначения. Что должно
          пережить переход — открытый раздел, вкладка, фильтры — живёт в
          адресе и не теряется. */}
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
      className="flex flex-col gap-block"
    >
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}
