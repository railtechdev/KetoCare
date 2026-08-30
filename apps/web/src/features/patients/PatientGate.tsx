import { Button, EmptyState, ErrorState, Skeleton } from "@ketocare/ui";
import { Baby, Users } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import { errorMessageOf } from "../../lib/api";
import { usePatients } from "./usePatients";
import { useSelectedPatient } from "./useSelectedPatient";

/**
 * Экран о конкретном ребёнке.
 *
 * Определение ребёнка вынесено сюда из самих экранов по двум причинам. Первая:
 * правило одно, а экранов четыре — разойтись им нельзя. Вторая: экран, знающий
 * про адресную строку, невозможно отрисовать в тесте без роутера, и проверка
 * начинает зависеть от способа выбора, а не от того, что показано.
 *
 * Ниже по дереву `patientId` — обычная строка, и экран не думает о том, откуда
 * она взялась.
 */
export function PatientGate({
  render,
}: {
  render: (patientId: string) => ReactElement;
}) {
  const { t } = useTranslation();
  const {
    patientId,
    patients: available,
    needsChoice,
    isPending,
    select,
  } = useSelectedPatient();
  const patients = usePatients();

  if (isPending) {
    return (
      <div className="flex flex-col gap-block" role="status" aria-busy="true">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (patients.error !== null) {
    return (
      <ErrorState
        title={t("patientGate.errorTitle")}
        description={
          errorMessageOf(patients.error) ?? t("errors.unexpected") ?? undefined
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void patients.refetch()}
      />
    );
  }

  if (needsChoice) {
    // Выбор предлагается здесь же, а не отсылкой «в списке наверху страницы»:
    // переключатель в шапке есть только у родителя, и у врача, попавшего сюда
    // из меню, отсылать было бы некуда. Пустое состояние без выхода — тупик,
    // и это тот же тупик, который экран должен закрывать (правило П15).
    return (
      <EmptyState
        icon={Users}
        title={t("patientGate.chooseTitle")}
        description={t("patientGate.chooseBody")}
        action={
          <ul className="m-0 flex list-none flex-wrap justify-center gap-field p-0">
            {available.map((patient) => (
              <li key={patient.id}>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-touch"
                  onClick={() => select(patient.id)}
                >
                  {patient.full_name}
                </Button>
              </li>
            ))}
          </ul>
        }
      />
    );
  }

  if (patientId === null) {
    return (
      <EmptyState
        icon={Baby}
        title={t("patientGate.noneTitle")}
        description={t("patientGate.noneBody")}
        action={
          <Button asChild>
            <SectionLink section="child">
              {t("patientGate.addChild")}
            </SectionLink>
          </Button>
        }
      />
    );
  }

  return render(patientId);
}
