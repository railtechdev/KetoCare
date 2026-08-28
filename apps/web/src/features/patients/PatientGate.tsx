import { WarningBanner } from "@ketocare/ui";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
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
  const { patientId, needsChoice, isPending } = useSelectedPatient();
  const patients = usePatients();

  if (isPending) {
    return (
      <p role="status" className="m-0 text-muted">
        {t("patientGate.loading")}
      </p>
    );
  }

  if (patients.error !== null) {
    return (
      <FormError>
        {errorMessageOf(patients.error) ?? t("errors.unexpected")}
      </FormError>
    );
  }

  if (needsChoice) {
    return (
      <WarningBanner level="info" title={t("patientGate.chooseTitle")}>
        {t("patientGate.chooseBody")}
      </WarningBanner>
    );
  }

  if (patientId === null) {
    return (
      <WarningBanner level="info" title={t("patientGate.noneTitle")}>
        <p className="m-0">{t("patientGate.noneBody")}</p>
        <SectionLink
          section="settings"
          className="mt-2 inline-flex min-h-touch items-center text-accent"
        >
          {t("patientGate.addChild")}
        </SectionLink>
      </WarningBanner>
    );
  }

  return render(patientId);
}
