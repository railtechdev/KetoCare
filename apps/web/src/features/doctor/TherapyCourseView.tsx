import {
  AsyncSection,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Fact,
  FactList,
  FormFooter,
  FormSheet,
  Section,
  toast,
} from "@ketocare/ui";
import { CalendarClock, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Field, SelectField, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { formatIsoDate } from "./dates";
import { useMedicalProfile } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";
import {
  THERAPY_END_REASONS,
  useControlSchedule,
  useTherapyCourseMutations,
  type ControlVisit,
  type TherapyEndReason,
} from "./therapyCourse";
import { queryState } from "../../lib/queryState";

/** Сегодня в формате поля `type="date"` по часам браузера. */
function todayInput(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Ход терапии: завершение и контрольные визиты (вопросы 17, 18, 34; ADR-0050).
 *
 * Врач ставит и меняет, диетолог читает (`editable`) — как у медицинского
 * профиля (ADR-0031). Значений анализов здесь нет и не будет без отдельного
 * решения клиники: она назвала ввод показателей затратным и попросила
 * напоминание, а не таблицу.
 */
export function TherapyCourseView({
  patientId,
  editable,
}: {
  patientId: string;
  editable: boolean;
}) {
  const { t } = useTranslation("doctor");
  const schedule = useControlSchedule(patientId);
  const profile = useMedicalProfile(patientId, true);
  const mutations = useTherapyCourseMutations(patientId);
  const [endOpen, setEndOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);

  const endedOn = profile.data?.therapy_ended_on ?? null;
  const startedOn = schedule.data?.therapy_started_on ?? null;
  const visits = schedule.data?.visits ?? [];

  return (
    <>
      <Section
        title={t("course.status.title")}
        density="compact"
        action={
          editable &&
          (endedOn === null ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setEndOpen(true)}
            >
              {t("course.status.end")}
            </Button>
          ) : (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="outline">
                  {t("course.status.resume")}
                </Button>
              }
              title={t("course.status.resumeTitle")}
              description={t("course.status.resumeDescription")}
              confirmLabel={t("course.status.resume")}
              cancelLabel={t("common:actions.cancel")}
              onConfirm={() =>
                mutations.resumeTherapy.mutate(undefined, {
                  onSuccess: () => toast.success(t("course.status.resumed")),
                  onError: (error) =>
                    toast.error(
                      errorMessageOf(error) ?? t("common:errors.unexpected"),
                    ),
                })
              }
            />
          ))
        }
      >
        <FactList>
          <Fact
            label={t("course.status.state")}
            value={
              endedOn === null
                ? t("course.status.active")
                : t("course.status.ended", {
                    date: formatIsoDate(endedOn) ?? endedOn,
                  })
            }
          />
          <Fact
            label={t("course.status.startedOn")}
            value={startedOn === null ? null : formatIsoDate(startedOn)}
          />
          {endedOn !== null && profile.data?.therapy_end_reason && (
            <Fact
              label={t("course.status.reason")}
              value={t(`course.reasons.${profile.data.therapy_end_reason}`)}
            />
          )}
          {endedOn !== null && profile.data?.therapy_end_note && (
            <Fact
              label={t("course.status.note")}
              value={profile.data.therapy_end_note}
              multiline
            />
          )}
        </FactList>
        {endedOn !== null && (
          <p className="m-0 mt-2 text-sm text-muted-foreground">
            {t("course.status.endedHint")}
          </p>
        )}
      </Section>

      <Section
        title={t("course.visits.title")}
        description={t("course.visits.description")}
        density="compact"
        action={
          editable && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={
                  startedOn === null || mutations.buildSchedule.isPending
                }
                onClick={() =>
                  mutations.buildSchedule.mutate(undefined, {
                    onSuccess: (created) =>
                      toast.success(
                        created.length === 0
                          ? t("course.visits.scheduleUpToDate")
                          : t("course.visits.scheduleBuilt", {
                              count: created.length,
                            }),
                      ),
                    onError: (error) =>
                      toast.error(
                        errorMessageOf(error) ?? t("common:errors.unexpected"),
                      ),
                  })
                }
              >
                {t("course.visits.build")}
              </Button>
              <Button type="button" onClick={() => setVisitOpen(true)}>
                <Plus aria-hidden="true" />
                {t("course.visits.add")}
              </Button>
            </div>
          )
        }
      >
        {editable && startedOn === null && (
          <p className="m-0 mb-2 text-sm text-muted-foreground">
            {t("course.visits.noStart")}
          </p>
        )}
        <AsyncSection
          {...queryState(schedule)}
          skeleton={
            <LinesSkeleton label={t("course.visits.loading")} lines={4} />
          }
          error={
            schedule.isError
              ? {
                  title: t("course.visits.loadError"),
                  description:
                    errorMessageOf(schedule.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void schedule.refetch()}
          isEmpty={visits.length === 0}
          empty={
            <EmptyState
              icon={CalendarClock}
              title={t("course.visits.empty")}
              description={t("course.visits.emptyDescription")}
            />
          }
        >
          <ul className="m-0 flex list-none flex-col gap-section p-0">
            {visits.map((visit) => (
              <li key={visit.id}>
                <VisitItem
                  visit={visit}
                  editable={editable}
                  patientId={patientId}
                />
              </li>
            ))}
          </ul>
        </AsyncSection>
      </Section>

      {schedule.data && (
        <Section
          title={t("course.labs.title")}
          description={t("course.labs.description")}
          density="compact"
        >
          <FactList>
            <Fact
              label={t("course.labs.weekly")}
              value={schedule.data.weekly_labs.join(", ")}
            />
            <Fact
              label={t("course.labs.periodic")}
              value={schedule.data.periodic_labs.join(", ")}
            />
          </FactList>
        </Section>
      )}

      {editable && (
        <>
          <EndTherapySheet
            open={endOpen}
            onOpenChange={setEndOpen}
            patientId={patientId}
          />
          <AddVisitSheet
            open={visitOpen}
            onOpenChange={setVisitOpen}
            patientId={patientId}
          />
        </>
      )}
    </>
  );
}

function VisitItem({
  visit,
  editable,
  patientId,
}: {
  visit: ControlVisit;
  editable: boolean;
  patientId: string;
}) {
  const { t } = useTranslation("doctor");
  const { updateVisit, deleteVisit } = useTherapyCourseMutations(patientId);
  const planned = formatIsoDate(visit.planned_on) ?? visit.planned_on;

  return (
    <article className="rounded-xl border border-border p-3">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-semibold tabular-nums">{planned}</span>
        <span className="text-sm text-muted-foreground">
          {visit.month_offset === null || visit.month_offset === undefined
            ? t("course.visits.manual")
            : t("course.visits.month", { count: visit.month_offset })}
        </span>
        {visit.purpose && (
          <Badge variant="secondary">
            {t(`course.purpose.${visit.purpose}`)}
          </Badge>
        )}
        {visit.completed_on ? (
          <Badge variant="outline">
            {t("course.visits.done", {
              date: formatIsoDate(visit.completed_on) ?? visit.completed_on,
            })}
          </Badge>
        ) : (
          visit.overdue && (
            <Badge variant="destructive">{t("course.visits.overdue")}</Badge>
          )
        )}
      </header>
      {(visit.labs ?? []).length > 0 && (
        <p className="m-0 mt-2 text-sm">
          {t("course.visits.labs", { labs: (visit.labs ?? []).join(", ") })}
        </p>
      )}
      {visit.note && (
        <p className="m-0 mt-2 text-sm whitespace-pre-line">{visit.note}</p>
      )}
      {editable && (
        <div className="mt-2 flex flex-wrap gap-2">
          {!visit.completed_on && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={updateVisit.isPending}
              onClick={() =>
                updateVisit.mutate(
                  { visitId: visit.id, body: { completed_on: todayInput() } },
                  {
                    onSuccess: () => toast.success(t("course.visits.marked")),
                    onError: (error) =>
                      toast.error(
                        errorMessageOf(error) ?? t("common:errors.unexpected"),
                      ),
                  },
                )
              }
            >
              {t("course.visits.markDone")}
            </Button>
          )}
          <ConfirmDialog
            trigger={
              <Button type="button" size="sm" variant="ghost">
                {t("course.visits.remove")}
              </Button>
            }
            title={t("course.visits.removeTitle", { date: planned })}
            confirmLabel={t("course.visits.remove")}
            cancelLabel={t("common:actions.cancel")}
            destructive
            onConfirm={() =>
              deleteVisit.mutate(visit.id, {
                onError: (error) =>
                  toast.error(
                    errorMessageOf(error) ?? t("common:errors.unexpected"),
                  ),
              })
            }
          />
        </div>
      )}
    </article>
  );
}

function EndTherapySheet({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const { t } = useTranslation("doctor");
  const ids = useId();
  const { endTherapy } = useTherapyCourseMutations(patientId);
  const [endedOn, setEndedOn] = useState(todayInput);
  const [reason, setReason] = useState<TherapyEndReason | "">("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const reasonMissing = reason === "";
  const noteMissing = reason === "other" && note.trim() === "";

  function close() {
    onOpenChange(false);
    setReason("");
    setNote("");
    setSubmitted(false);
    endTherapy.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (reason === "" || noteMissing || endedOn === "") return;
    endTherapy.mutate(
      { ended_on: endedOn, reason, note: note.trim() || null },
      {
        onSuccess: () => {
          toast.success(t("course.status.endedToast"));
          close();
        },
      },
    );
  }

  return (
    <FormSheet
      closeLabel={t("common:actions.close")}
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("course.status.endTitle")}
      description={t("course.status.endDescription")}
    >
      <form noValidate className="flex flex-col gap-section" onSubmit={submit}>
        <Field
          id={`${ids}-ended-on`}
          type="date"
          width="narrow"
          label={t("course.fields.endedOn")}
          max={todayInput()}
          value={endedOn}
          onChange={(event) => setEndedOn(event.target.value)}
          error={
            submitted && endedOn === "" ? t("course.errors.date") : undefined
          }
        />
        <SelectField
          id={`${ids}-reason`}
          label={t("course.fields.reason")}
          hint={t("course.fields.reasonHint")}
          value={reason}
          onChange={(event) =>
            setReason(event.target.value as TherapyEndReason | "")
          }
          error={
            submitted && reasonMissing ? t("course.errors.reason") : undefined
          }
        >
          <option value="">{t("course.fields.reasonPlaceholder")}</option>
          {THERAPY_END_REASONS.map((value) => (
            <option key={value} value={value}>
              {t(`course.reasons.${value}`)}
            </option>
          ))}
        </SelectField>
        <TextAreaField
          id={`${ids}-note`}
          rows={3}
          optional={reason !== "other"}
          label={t("course.fields.note")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          error={submitted && noteMissing ? t("course.errors.note") : undefined}
        />
        {endTherapy.isError && (
          <FormError>
            {errorMessageOf(endTherapy.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}
        <FormFooter
          submitLabel={t("course.status.endSubmit")}
          pendingLabel={t("course.status.endPending")}
          pending={endTherapy.isPending}
          onCancel={close}
          cancelLabel={t("common:actions.cancel")}
        />
      </form>
    </FormSheet>
  );
}

function AddVisitSheet({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const { t } = useTranslation("doctor");
  const ids = useId();
  const { addVisit } = useTherapyCourseMutations(patientId);
  const [plannedOn, setPlannedOn] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function close() {
    onOpenChange(false);
    setPlannedOn("");
    setNote("");
    setSubmitted(false);
    addVisit.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (plannedOn === "") return;
    addVisit.mutate(
      { planned_on: plannedOn, note: note.trim() || null },
      {
        onSuccess: () => {
          toast.success(t("course.visits.added"));
          close();
        },
      },
    );
  }

  return (
    <FormSheet
      closeLabel={t("common:actions.close")}
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("course.visits.addTitle")}
    >
      <form noValidate className="flex flex-col gap-section" onSubmit={submit}>
        <Field
          id={`${ids}-planned-on`}
          type="date"
          width="narrow"
          label={t("course.fields.plannedOn")}
          value={plannedOn}
          onChange={(event) => setPlannedOn(event.target.value)}
          error={
            submitted && plannedOn === "" ? t("course.errors.date") : undefined
          }
        />
        <TextAreaField
          id={`${ids}-visit-note`}
          rows={3}
          optional
          label={t("course.fields.visitNote")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {addVisit.isError && (
          <FormError>
            {errorMessageOf(addVisit.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}
        <FormFooter
          submitLabel={t("course.visits.addSubmit")}
          pendingLabel={t("course.visits.addPending")}
          pending={addVisit.isPending}
          onCancel={close}
          cancelLabel={t("common:actions.cancel")}
        />
      </form>
    </FormSheet>
  );
}
