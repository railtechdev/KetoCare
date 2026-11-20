import {
  AS_NEEDED_FREQUENCY,
  AsyncSection,
  Button,
  Section,
  describeMedicationFrequency,
  formatTime,
  medicationBody,
  randomKey,
  toDateInput,
  toDateTimeLocalInput,
  toast,
} from "@ketocare/ui";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useEntryMutations } from "../diary/useDiary";
import type { Session } from "../session/useSession";
import {
  type ActiveMedication,
  useActiveMedications,
  useTodayMedicationLogs,
} from "./useMedicationsToday";

/**
 * «Лекарства сегодня» — отметить приём, не уходя с «Сегодня» (аудит Mini App
 * 21.11.2026, Д4).
 *
 * Лекарства — самая частая запись, а отмечали их через «Дневник → Добавить
 * запись → Лекарство», по одному. В боте это список: «Дали» или «Пропустили»
 * пишет по записи на препарат с `taken: true / false` — так их читает врач
 * (ADR-0076). Здесь то же: строка на препарат схемы, две кнопки, отметка —
 * сразу «сейчас». Пропуск врачу важен не меньше приёма, поэтому «Пропустили»
 * — такая же кнопка, а не отсутствие отметки. У препарата «по требованию»
 * расписания нет, и «пропустить» его нельзя — только «Дали».
 *
 * Ошиблись кнопкой — «Отменить» в сообщении убирает только что сделанную
 * запись (свою: правит только автор). Тело записи и проверка — из кита
 * (ADR-0044), ключ попытки — на каждое нажатие (ADR-0035).
 *
 * Блока нет, пока у ребёнка нет препаратов на сегодня: пустой заголовок на
 * главной — шум.
 *
 * Утренние препараты дают вместе и отмечают подряд, часто на медленной связи.
 * Поэтому каждое нажатие ведётся само по себе: своё сообщение, своя «Отменить»
 * и своя ошибка, а кнопки препарата заперты, пока не ответили именно на его
 * отметку. Одна общая мутация с колбэками на вызов теряла всё это у первого
 * нажатия, стоило сделать второе: TanStack Query v5 оставляет колбэки только
 * последнего `mutate`, а повторное нажатие на первый препарат заводило бы
 * вторую запись — врач прочёл бы две дозы.
 *
 * Блок не вытесняет главное с «Сегодня»: строка препарата — имя с дозой и
 * кратность, а при длинной схеме видны первые {@link VISIBLE_MEDICATIONS},
 * остальные — по кнопке. Порядок — схемы врача и после отметки не меняется:
 * переставлять строки под пальцем нельзя.
 */
/**
 * Сколько препаратов видно сразу. Пять строк схемы — частое дело при
 * резистентной эпилепсии — занимали больше экрана 360 × 640 и уводили
 * ближайший приём пищи на два экрана вниз. Прятать одну строку за кнопку той
 * же высоты незачем, поэтому список сворачивается от пяти.
 */
const VISIBLE_MEDICATIONS = 3;

export function MedicationsToday({ session }: { session: Session }) {
  const { t } = useTranslation();
  const day = toDateInput(new Date());
  const medications = useActiveMedications(session.patientId, day);
  const logs = useTodayMedicationLogs(session.patientId);
  const { create, remove } = useEntryMutations(session.patientId);
  // Препараты, отметка которых ещё в пути. Ссылка — для проверки в момент
  // нажатия (два касания до перерисовки), состояние — для кнопок.
  const inFlight = useRef(new Set<string>());
  const [marking, setMarking] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  // Пока ответа нет — молчим: блок появляется только с препаратами.
  if (medications.data === undefined && !medications.isError) return null;
  if (medications.data?.length === 0) return null;

  const track = (medicationId: string, busy: boolean) => {
    if (busy) inFlight.current.add(medicationId);
    else inFlight.current.delete(medicationId);
    setMarking(new Set(inFlight.current));
  };

  const frequencyOf = (medication: ActiveMedication) =>
    describeMedicationFrequency(medication, (code) =>
      t(`today.medications.frequency.${code}`),
    );

  const undo = (logId: string) => {
    // Свой исход у каждой отмены: два «Отменить» подряд не теряют первого.
    remove.mutateAsync({ kind: "medications", id: logId }).then(
      () => toast.success(t("today.medications.undone")),
      (error: unknown) =>
        toast.error(errorMessageOf(error) ?? t("today.medications.undoFailed")),
    );
  };

  const mark = (medication: ActiveMedication, taken: boolean) => {
    if (inFlight.current.has(medication.id)) return;
    const body = medicationBody({
      occurredAt: toDateTimeLocalInput(new Date()),
      medicationId: medication.id,
      taken,
    });
    if (body === null || body.kind !== "medications") return;
    track(medication.id, true);
    // `mutateAsync`, а не колбэки `mutate`: обещание исполняется у каждого
    // вызова, колбэки — только у последнего.
    create
      .mutateAsync({ body, idempotencyKey: randomKey() })
      .then(
        (created) => {
          const logId = created.id;
          toast.success(
            t(
              taken
                ? "today.medications.markedGiven"
                : "today.medications.markedSkipped",
              { name: medication.drug_name },
            ),
            logId === null
              ? undefined
              : {
                  action: {
                    label: t("today.medications.undo"),
                    onClick: () => undo(logId),
                  },
                },
          );
        },
        (error: unknown) =>
          toast.error(
            errorMessageOf(error) ?? t("today.medications.markFailed"),
          ),
      )
      .finally(() => track(medication.id, false));
  };

  const all = medications.data ?? [];
  const collapsed = !expanded && all.length > VISIBLE_MEDICATIONS + 1;
  const shown = collapsed ? all.slice(0, VISIBLE_MEDICATIONS) : all;

  return (
    <Section title={t("today.medications.title")} density="compact">
      <AsyncSection
        loading={false}
        skeleton={null}
        error={
          medications.isError
            ? {
                title: t("today.medications.loadError"),
                description:
                  errorMessageOf(medications.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void medications.refetch()}
        isEmpty={false}
        empty={null}
      >
        <ul className="m-0 flex list-none flex-col gap-section p-0">
          {shown.map((medication) => {
            const frequency = frequencyOf(medication);
            const marks = (logs.data ?? [])
              .filter((entry) => entry.medication_id === medication.id)
              .sort(
                (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
              );
            const busy = marking.has(medication.id);
            const asNeeded = medication.frequency_code === AS_NEEDED_FREQUENCY;
            return (
              <li key={medication.id} className="flex flex-col gap-1">
                {/* Имя и доза — одной строкой: так препарат читают на
                    упаковке, и строка кратности под ней не переносится. */}
                <p className="m-0">
                  <span className="font-medium">{medication.drug_name}</span>
                  {medication.dose !== "" && (
                    <span className="text-muted-foreground">
                      {" · "}
                      {medication.dose}
                    </span>
                  )}
                </p>
                {frequency !== "" && (
                  <p className="m-0 text-sm text-muted-foreground">
                    {frequency}
                  </p>
                )}
                {marks.length > 0 && (
                  <p className="m-0 text-sm tabular-nums">
                    {marks
                      .map((entry) =>
                        t(
                          entry.taken
                            ? "today.medications.givenAt"
                            : "today.medications.skippedAt",
                          { time: formatTime(new Date(entry.occurred_at)) },
                        ),
                      )
                      .join(", ")}
                  </p>
                )}
                <div className="flex gap-field">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-touch flex-1"
                    disabled={busy}
                    aria-label={t("today.medications.giveAria", {
                      name: medication.drug_name,
                    })}
                    onClick={() => mark(medication, true)}
                  >
                    {t("today.medications.give")}
                  </Button>
                  {!asNeeded && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-touch flex-1"
                      disabled={busy}
                      aria-label={t("today.medications.skipAria", {
                        name: medication.drug_name,
                      })}
                      onClick={() => mark(medication, false)}
                    >
                      {t("today.medications.skip")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {all.length > VISIBLE_MEDICATIONS + 1 && (
          <Button
            type="button"
            variant="ghost"
            className="mt-field min-h-touch w-full"
            aria-expanded={!collapsed}
            onClick={() => setExpanded(collapsed)}
          >
            {collapsed
              ? t("today.medications.showRest", {
                  count: all.length - VISIBLE_MEDICATIONS,
                })
              : t("today.medications.collapse")}
          </Button>
        )}
      </AsyncSection>
    </Section>
  );
}
