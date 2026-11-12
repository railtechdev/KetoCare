import {
  AsyncSection,
  Button,
  Input,
  Section,
  Switch,
  toast,
} from "@ketocare/ui";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { haptic } from "../../lib/telegram";
import { useBottomButtons } from "../../lib/useTelegram";
import type { Session } from "../session/useSession";
import {
  type ReminderValues,
  useReminderSettings,
  useSaveReminders,
} from "./useReminders";

/** Виды напоминаний в том порядке, в каком идёт день — как в кабинете. */
const KINDS = ["ketones", "medications", "weight", "no_records"] as const;

type Kind = (typeof KINDS)[number];

const FIELD: Record<Kind, Exclude<keyof ReminderValues, "enabled">> = {
  ketones: "ketones_at",
  medications: "medications_at",
  weight: "weight_at",
  no_records: "no_records_at",
};

/**
 * Время для поля `time`: сервер отдаёт «20:00:00», поле ждёт «20:00».
 * Секунд у напоминания нет — рассылка идёт раз в пять минут.
 */
function toTimeInput(value: string | null | undefined): string {
  return value == null ? "" : value.slice(0, 5);
}

/**
 * «Напоминания» — когда бот напомнит о записи (раздел 7.4 ТЗ, ADR-0044).
 *
 * Прежде настраивались только в веб-кабинете, а у семьи из Telegram его нет:
 * она получала умолчание «вечером в 20:00» и не могла ни сдвинуть его, ни
 * выключить на неделю в больнице. Поля и подсказки — те же, что в кабинете.
 */
export function RemindersBlock({ session }: { session: Session }) {
  const { t } = useTranslation();
  const ids = useId();
  const settings = useReminderSettings(session.patientId);
  const save = useSaveReminders(session.patientId);
  const [form, setForm] = useState<ReminderValues | null>(null);

  const submit = () => {
    if (form === null || save.isPending) return;
    save.mutate(form, {
      onSuccess: () => {
        haptic("success");
        toast.success(t("reminders.saved"));
      },
      onError: () => haptic("error"),
    });
  };
  // Изменено ли что-то против сохранённого: «Сохранить» нужен только тогда.
  const dirty =
    form !== null &&
    settings.data !== undefined &&
    (Object.keys(form) as (keyof ReminderValues)[]).some(
      (key) => form[key] !== settings.data[key],
    );
  // «Сохранить напоминания» — родной кнопкой Telegram внизу экрана настроек
  // (Bot API 7.10), пока есть что сохранять.
  const native = useBottomButtons(
    dirty
      ? {
          main: {
            text: save.isPending
              ? t("reminders.saving")
              : t("reminders.submit"),
            onClick: submit,
            progress: save.isPending,
          },
        }
      : null,
  );

  // Пустое поле здесь значит «выключено», поэтому до ответа сервера форма не
  // показывается вовсе: пустая — она утверждала бы неправду.
  useEffect(() => {
    if (settings.data !== undefined) {
      const { patient_id: _patient, ...values } = settings.data;
      setForm(values);
    }
  }, [settings.data]);

  return (
    <Section title={t("reminders.title")} density="compact">
      <p className="m-0 text-muted-foreground">{t("reminders.intro")}</p>

      <AsyncSection
        loading={settings.isPending}
        skeleton={null}
        error={
          settings.isError
            ? {
                title: t("reminders.loadError"),
                description:
                  errorMessageOf(settings.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        // Без сети об этом уже говорит сводка выше.
        waiting={null}
        retryLabel={t("actions.retry")}
        onRetry={() => void settings.refetch()}
        isEmpty={false}
        empty={null}
      >
        {form !== null && (
          // На своём экране настроек форма открыта сразу: сворачивать её было
          // нужно, пока она стояла на главной под сводкой дня.
          <form
            noValidate
            className="flex flex-col gap-field"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex flex-col gap-1">
              {/* Цель касания — вся строка во всю ширину. Переключатель, а не
                    флажок: напоминания включаются целиком, как в настройках
                    самого Telegram. */}
              <label className="flex min-h-touch w-full cursor-pointer items-center gap-field">
                <Switch
                  checked={form.enabled}
                  aria-describedby={`${ids}-enabled-hint`}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                />
                <span className="min-w-0 flex-1">{t("reminders.enabled")}</span>
              </label>
              {/* Визит к врачу своего поля не имеет, но выключатель действует
                    и на него — так и сказано, а не подразумевается. */}
              <span
                id={`${ids}-enabled-hint`}
                className="text-sm text-muted-foreground"
              >
                {t("reminders.enabledHint")}
              </span>
            </div>

            {KINDS.map((kind) => {
              const id = `${ids}-${kind}`;
              const value = toTimeInput(form[FIELD[kind]]);
              const label = t(`reminders.kinds.${kind}`);
              return (
                <div key={kind} className="flex flex-col gap-1">
                  <label htmlFor={id}>{label}</label>
                  <div className="flex flex-wrap items-center gap-field">
                    <Input
                      id={id}
                      type="time"
                      className="min-h-touch w-36 tabular-nums"
                      disabled={!form.enabled}
                      aria-describedby={`${id}-hint`}
                      value={value}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          [FIELD[kind]]:
                            event.target.value === ""
                              ? null
                              : event.target.value,
                        })
                      }
                    />
                    {/* На телефоне у поля времени не всегда есть «очистить»,
                        а пустое время — единственный способ выключить вид. */}
                    {value !== "" && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-touch"
                        disabled={!form.enabled}
                        aria-label={t("reminders.clearAria", { kind: label })}
                        onClick={() =>
                          setForm({ ...form, [FIELD[kind]]: null })
                        }
                      >
                        {t("reminders.clear")}
                      </Button>
                    )}
                  </div>
                  <span
                    id={`${id}-hint`}
                    className="text-sm text-muted-foreground"
                  >
                    {t(`reminders.hints.${kind}`)}
                  </span>
                </div>
              );
            })}

            {save.isError && (
              <p role="alert" className="m-0 text-destructive">
                {errorMessageOf(save.error) ?? t("reminders.saveFailed")}
              </p>
            )}

            {!native && (
              <Button
                type="submit"
                className="min-h-touch w-full"
                disabled={save.isPending}
              >
                {save.isPending ? t("reminders.saving") : t("reminders.submit")}
              </Button>
            )}
          </form>
        )}
      </AsyncSection>
    </Section>
  );
}
