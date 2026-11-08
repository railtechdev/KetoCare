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
 * «Врач задал назначение» — страховка к уведомлению в Telegram.
 *
 * О новом назначении сообщает бот (задача воркера `notify_family`, раздел 5.4
 * ТЗ). У семьи без привязанного Telegram другого канала нет: почты в продукте
 * нет, и она узнала бы о назначении, только заметив, что числа на главной
 * изменились, — а по этим числам она кормит ребёнка в тот же день. Поэтому
 * блок заметный и уходит по нажатию.
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
