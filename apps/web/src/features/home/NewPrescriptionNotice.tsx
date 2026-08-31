import { Button, Section } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import { formatOverviewDate } from "./date";
import {
  isNewPrescription,
  readSeenPrescription,
  storeSeenPrescription,
} from "./seenPrescription";
import type { PrescriptionRead } from "./types";

/**
 * «Врач задал назначение» — на месте несуществующего уведомления.
 *
 * В коде на месте отправки стоит `TODO: notify_family`: задачи в воркере нет,
 * почты в продукте нет, бот сообщений не шлёт. Семья узнавала о назначении,
 * только заметив, что числа на главной изменились, — а по этим числам она
 * кормит ребёнка в тот же день.
 *
 * Это не замена уведомления, а то, что можно сделать до него: заметный блок,
 * который уходит по нажатию. Когда появится канал (бот — пункт 16 ТЗ),
 * сообщение придёт туда, а блок останется страховкой на случай, когда Telegram
 * не привязан.
 */
export function NewPrescriptionNotice({
  patientId,
  prescription,
}: {
  patientId: string;
  prescription: PrescriptionRead;
}) {
  const { t } = useTranslation("home");
  const [seenId, setSeenId] = useState(() => readSeenPrescription(patientId));

  if (
    !isNewPrescription(
      prescription.created_at,
      seenId,
      prescription.id,
      new Date(),
    )
  )
    return null;

  return (
    <Section
      title={t("newPrescription.title")}
      description={t("newPrescription.intro", {
        date: formatOverviewDate(prescription.created_at.slice(0, 10)),
      })}
      density="compact"
      action={
        <Button
          type="button"
          variant="outline"
          className="min-h-touch"
          onClick={() => {
            storeSeenPrescription(patientId, prescription.id);
            setSeenId(prescription.id);
          }}
        >
          {t("newPrescription.dismiss")}
        </Button>
      }
    >
      <p className="m-0">
        {t("newPrescription.body")}{" "}
        <SectionLink
          section="menu"
          className="font-medium underline-offset-2 hover:underline"
        >
          {t("newPrescription.toMenu")}
        </SectionLink>
      </p>
    </Section>
  );
}
