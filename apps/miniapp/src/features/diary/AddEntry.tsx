import { Button, FormSheet } from "@ketocare/ui";
import { useContext, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { OpenTabContext } from "../../lib/tabs";
import { useTelegramBack } from "../../lib/useTelegram";
import type { Session } from "../session/useSession";
import { EntryEditSheet } from "./EntryEditSheet";
import { KIND_ICON } from "./kinds";
import {
  DIARY_KINDS,
  type CreatableKind,
  useDurationOptions,
  useEntryMutations,
  useMedications,
  useSeizureTypes,
} from "./useDiary";

/** Что открыто: выбор вида, пояснение про еду или форма вида. */
type Step =
  { at: "chooser" } | { at: "meals" } | { at: "form"; kind: CreatableKind };

/**
 * «Добавить запись» в Mini App — выбор вида, затем та же форма, что у правки
 * (дополнение к ADR-0044 от 07.10.2026).
 *
 * До этого записать можно было только кнопками бота, а пустой дневник
 * отправлял туда же — тупик для того, кто открыл приложение, а не чат, и для
 * взрослого, которому проще нажать, чем прочитать инструкцию.
 *
 * «Назад» Telegram идёт по шагам: из формы — к выбору вида, из выбора —
 * закрыть. Без этого аппаратная «Назад» на Android закрывала бы весь Mini App
 * вместе с недописанной записью.
 */
export function AddEntry({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ at: "chooser" });
  const seizureTypes = useSeizureTypes();
  const durationOptions = useDurationOptions();
  const medications = useMedications(session.patientId);
  const { create } = useEntryMutations(session.patientId);

  if (step.at === "form") {
    return (
      <EntryEditSheet
        key={step.kind}
        target={{ kind: step.kind }}
        title={t(`diary.add.kinds.${step.kind}`)}
        seizureTypes={seizureTypes.data ?? []}
        durationOptions={durationOptions.data ?? []}
        medications={medications.data ?? []}
        pending={create.isPending}
        error={create.error}
        onSave={(body, onSaved, attemptKey) => {
          // Еда сюда не доходит: у неё нет формы (см. `KindChooser`).
          if (body.kind === "meals") return;
          create.mutate(
            { body, idempotencyKey: attemptKey },
            { onSuccess: onSaved },
          );
        }}
        onClose={onClose}
        onBack={() => {
          create.reset();
          setStep({ at: "chooser" });
        }}
      />
    );
  }

  return (
    <KindChooser
      step={step}
      // Пустая схема — отмечать нечего; пока не загружена, выбор открыт:
      // форма скажет сама, если выбрать не из чего.
      noMedications={medications.data?.length === 0}
      onStep={setStep}
      onClose={onClose}
    />
  );
}

function KindChooser({
  step,
  noMedications,
  onStep,
  onClose,
}: {
  step: { at: "chooser" } | { at: "meals" };
  noMedications: boolean;
  onStep: (step: Step) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const openTab = useContext(OpenTabContext);
  const medicationsReasonId = useId();

  const back = () => {
    if (step.at === "meals") onStep({ at: "chooser" });
    else onClose();
  };
  useTelegramBack(back);

  return (
    <FormSheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t(
        step.at === "meals" ? "diary.add.mealsTitle" : "diary.add.title",
      )}
      closeLabel={t("diary.close")}
    >
      {step.at === "meals" ? (
        // Еда — не форма. Свободный текст здесь вошёл бы в дневник наравне с
        // блюдами из плана, а выдуманное блюдо — это выдуманные граммы в
        // итогах дня. Рецепт или своё блюдо ставятся в план и отмечаются там
        // «съедено» — тем же путём, каким их видит врач.
        <div className="flex flex-col gap-section">
          <p className="m-0">{t("diary.add.mealsBody")}</p>
          <div className="flex flex-wrap gap-field">
            <Button
              type="button"
              className="min-h-touch"
              onClick={() => {
                onClose();
                openTab("menu");
              }}
            >
              {t("diary.add.openMenu")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-touch"
              onClick={back}
            >
              {t("diary.back")}
            </Button>
          </div>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-field p-0">
          {DIARY_KINDS.map((kind) => {
            const Icon = KIND_ICON[kind];
            const blocked = kind === "medications" && noMedications;
            return (
              <li key={kind} className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-touch w-full justify-start gap-field"
                  disabled={blocked}
                  aria-describedby={blocked ? medicationsReasonId : undefined}
                  onClick={() =>
                    onStep(
                      kind === "meals" ? { at: "meals" } : { at: "form", kind },
                    )
                  }
                >
                  <Icon aria-hidden="true" className="size-5 shrink-0" />
                  {t(`diary.add.kinds.${kind}`)}
                </Button>
                {blocked && (
                  <p
                    id={medicationsReasonId}
                    className="m-0 text-sm text-muted-foreground"
                  >
                    {t("diary.add.noMedications")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </FormSheet>
  );
}
