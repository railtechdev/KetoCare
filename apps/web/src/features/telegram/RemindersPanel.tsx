import { AsyncSection, FormFooter, Section, toast } from "@ketocare/ui";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import {
  useReminderSettings,
  useUpdateRemindersMutation,
  type ReminderSettings,
} from "./useReminders";

/** Виды напоминаний в том порядке, в каком идёт день. */
const KINDS = ["ketones", "medications", "weight", "no_records"] as const;

type Kind = (typeof KINDS)[number];

const FIELD_BY_KIND: Record<Kind, keyof ReminderSettings> = {
  ketones: "ketones_at",
  medications: "medications_at",
  weight: "weight_at",
  no_records: "no_records_at",
};

/**
 * Когда бот напоминает (раздел 7.4 ТЗ).
 *
 * Настроек не было нигде, а задача воркера, которая по ним работает, не
 * существовала: обещание «бот напомнит» держалось ни на чём.
 *
 * Время задаёт семья, а не клиника: замер дома делают тогда, когда получается,
 * и расписание отделения к этому отношения не имеет. Пустое поле — этот вид
 * напоминаний выключен; выключить всё разом можно отдельным флажком, он нужен
 * в те недели, когда семья в больнице и напоминания только мешают.
 */
export function RemindersPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation("telegram");
  const ids = useId();

  const settings = useReminderSettings(patientId);
  const update = useUpdateRemindersMutation(patientId);

  const [form, setForm] = useState<ReminderSettings | null>(null);

  // Значения приходят с сервера (там же лежат умолчания), поэтому форма
  // наполняется после загрузки, а не инициализируется пустой: пустое поле здесь
  // означает «выключено», и показать его до ответа значит соврать.
  useEffect(() => {
    if (settings.data !== undefined) setForm(settings.data);
  }, [settings.data]);

  return (
    <Section title={t("reminders.title")} description={t("reminders.intro")}>
      <AsyncSection
        loading={settings.isPending}
        skeleton={null}
        error={
          settings.isError
            ? {
                title: t("reminders.loadError"),
                description:
                  errorMessageOf(settings.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void settings.refetch()}
        isEmpty={form === null}
        empty={null}
      >
        {form !== null && (
          <form
            noValidate
            className="flex flex-col gap-block"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate(form, {
                onSuccess: () => toast.success(t("reminders.saved")),
              });
            }}
          >
            <label className="flex items-center gap-field">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={form.enabled}
                onChange={(event) =>
                  setForm({ ...form, enabled: event.target.checked })
                }
              />
              <span>{t("reminders.enabled")}</span>
            </label>

            <div className="grid gap-block sm:grid-cols-2">
              {KINDS.map((kind) => (
                <Field
                  key={kind}
                  id={`${ids}-${kind}`}
                  type="time"
                  width="narrow"
                  optional
                  label={t(`reminders.kinds.${kind}`)}
                  hint={t(`reminders.hints.${kind}`)}
                  disabled={!form.enabled}
                  value={(form[FIELD_BY_KIND[kind]] as string | null) ?? ""}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      [FIELD_BY_KIND[kind]]:
                        event.target.value === "" ? null : event.target.value,
                    })
                  }
                />
              ))}
            </div>

            {update.isError && (
              <FormError>
                {errorMessageOf(update.error) ?? t("common:errors.unexpected")}
              </FormError>
            )}

            <FormFooter
              submitLabel={t("reminders.submit")}
              pendingLabel={t("reminders.saving")}
              pending={update.isPending}
            />
          </form>
        )}
      </AsyncSection>
    </Section>
  );
}
