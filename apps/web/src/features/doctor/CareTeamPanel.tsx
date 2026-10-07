import {
  ActionReason,
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  FormFooter,
  FormSheet,
  Section,
  toast,
} from "@ketocare/ui";
import { Plus, Stethoscope, UserMinus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { PersonPicker } from "../../components/PersonPicker";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { useCareTeamMutations } from "./doctorMutations";
import { useCareTeam, useColleagues } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";
import { isCareRole } from "./types";
import { queryState } from "../../lib/queryState";

/**
 * Кто ведёт пациента (ADR-0003, решение 3).
 *
 * Передача пациента коллеге и подключение диетолога были реализованы на
 * сервере целиком и не вызывались фронтендом ни разу: пациент оставался
 * навсегда закреплён за тем, кто выдал приглашение семье. Отпуск, увольнение,
 * второе мнение, подключение диетолога — ни один из этих случаев не имел
 * решения ни у одной роли, включая администратора: к клиническим данным у него
 * доступа нет (правило 5 CLAUDE.md).
 *
 * Снять последнего специалиста сервер не даёт (`len(doctor_ids) == 1`).
 * Кнопку, которая заведомо кончится отказом, панель выключает и называет
 * причину (правило П44) — правило то же и по тому же списку, что у сервера.
 * Отказ сервера по другой причине по-прежнему показывается под списком.
 */
export function CareTeamPanel({
  patientId,
  title,
  description,
  onSelfRemoved,
}: {
  patientId: string;
  /**
   * Специалист снял ведение с самого себя — доступа к карте у него больше нет.
   * Экран карты уводит в реестр: оставаться на карте значило бы смотреть на
   * отказы 403 вместо данных.
   */
  onSelfRemoved?: () => void;
  /**
   * Заголовок и пояснение блока.
   *
   * Список один и тот же, а обращены эти две строки к разным людям:
   * специалисту — «кто ведёт пациента, семья видит этот же список», семье —
   * «кто имеет доступ к данным ребёнка». Свои тексты дешевле пары пропсов и
   * несравнимо дешевле второй копии панели.
   */
  title?: string;
  description?: string;
}) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();
  const ids = useId();

  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [colleagueQuery, setColleagueQuery] = useState("");

  // Справочник персонала сервер отдаёт только doctor и dietitian. Запрашивать
  // его иначе — значит открывать заведомый 403 (правило П3 канона: действия,
  // которых нет, не показываются).
  const canWrite = isCareRole(session?.role);

  const team = useCareTeam(patientId);
  const colleagues = useColleagues(canWrite && formOpen);
  const { add, remove } = useCareTeamMutations(patientId);

  const teamIds = new Set((team.data ?? []).map((member) => member.id));
  // Последнего ведущего сервер снять не даёт (у пациента всегда есть
  // специалист). Кнопка, которая кончается отказом, — тупик: она выключена и
  // называет причину (правило П44).
  const soleSpecialist = (team.data ?? []).length === 1;
  const reasonId = useId();
  const candidates = (colleagues.data ?? []).filter(
    (colleague) => !teamIds.has(colleague.id),
  );

  return (
    <Section
      title={title ?? t("careTeam.title")}
      description={description ?? t("careTeam.intro")}
      density="compact"
      action={
        canWrite && (
          <Button type="button" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" />
            {t("careTeam.add")}
          </Button>
        )
      }
    >
      <AsyncSection
        {...queryState(team)}
        skeleton={<LinesSkeleton label={t("careTeam.loading")} lines={2} />}
        error={
          team.isError
            ? {
                title: t("careTeam.loadError"),
                description:
                  errorMessageOf(team.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void team.refetch()}
        isEmpty={(team.data ?? []).length === 0}
        empty={
          <EmptyState
            icon={Stethoscope}
            title={t("careTeam.empty")}
            description={t("careTeam.emptyDescription")}
          />
        }
      >
        <ul className="m-0 flex list-none flex-col gap-field p-0">
          {(team.data ?? []).map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
            >
              <span className="min-w-0 flex-1 break-words">
                {member.full_name}
              </span>
              <span className="text-sm text-muted-foreground">
                {t(`common:roles.${member.role}`)}
              </span>

              {canWrite && (
                /* Подтверждение называет специалиста: «снять ведение» без
                   имени — вопрос без объекта (правило П14 канона). */
                <ConfirmDialog
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-touch text-destructive"
                      disabled={soleSpecialist}
                      aria-describedby={soleSpecialist ? reasonId : undefined}
                      aria-label={t("careTeam.removeAria", {
                        name: member.full_name,
                      })}
                    >
                      <UserMinus aria-hidden="true" />
                      {t("careTeam.remove")}
                    </Button>
                  }
                  title={t("careTeam.confirmRemoveTitle", {
                    name: member.full_name,
                  })}
                  description={t("careTeam.confirmRemoveBody")}
                  confirmLabel={t("careTeam.confirmRemoveAction")}
                  cancelLabel={t("actions.cancel")}
                  onConfirm={() =>
                    remove.mutate(member.id, {
                      onSuccess: () => {
                        toast.success(t("careTeam.removed"));
                        if (member.id === session?.userId) onSelfRemoved?.();
                      },
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
        {canWrite && (
          <ActionReason id={reasonId}>
            {soleSpecialist ? t("careTeam.soleReason") : null}
          </ActionReason>
        )}
      </AsyncSection>

      {/* Ошибка снятия — не ошибка загрузки: повторять нечего. Так сервер
          сообщает и о запрете снять последнего специалиста. */}
      {remove.isError && (
        <FormError>
          {errorMessageOf(remove.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <FormSheet
        closeLabel={t("common:actions.close")}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setSelected("");
        }}
        title={t("careTeam.addTitle")}
        description={t("careTeam.addIntro")}
      >
        <form
          noValidate
          className="flex flex-col gap-section"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected === "") return;
            add.mutate(selected, {
              onSuccess: () => {
                toast.success(t("careTeam.added"));
                setFormOpen(false);
                setSelected("");
              },
            });
          }}
        >
          {/* Поиск, а не `select` всей клиники (правило П42): коллег
              десятки, и выбор перечислением превращался в пролистывание.
              Справочник персонала приходит целиком, без страницы, поэтому
              отбор по нему честен и идёт на месте — сервер для этого не нужен. */}
          <PersonPicker
            id={`${ids}-colleague`}
            label={t("careTeam.colleague")}
            hint={t("careTeam.colleagueHint")}
            placeholder={t("careTeam.colleaguePlaceholder")}
            selectedId={selected === "" ? undefined : selected}
            selectedName={
              candidates.find((colleague) => colleague.id === selected)
                ?.full_name
            }
            people={candidates.map((colleague) => ({
              id: colleague.id,
              name: colleague.full_name,
              detail: t(`common:roles.${colleague.role}`),
            }))}
            filter="local"
            query={colleagueQuery}
            onQueryChange={setColleagueQuery}
            status={colleagues.status}
            onRetry={() => void colleagues.refetch()}
            onSelect={(id) => setSelected(id ?? "")}
            texts={{
              search: t("careTeam.colleagueSearch"),
              empty: t("careTeam.colleagueNotFound"),
              loadError: t("careTeam.colleagueLoadError"),
              retry: t("common:actions.retry"),
            }}
          />

          {add.isError && (
            <FormError>
              {errorMessageOf(add.error) ?? t("common:errors.unexpected")}
            </FormError>
          )}

          <FormFooter
            submitLabel={t("careTeam.addAction")}
            pendingLabel={t("careTeam.adding")}
            pending={add.isPending}
            // Без выбора отправлять нечего — и кнопка говорит это словами, а
            // не молчит серым прямоугольником (правило П44).
            disabled={selected === ""}
            reason={selected === "" ? t("careTeam.chooseColleague") : undefined}
            onCancel={() => {
              setFormOpen(false);
              setSelected("");
            }}
            cancelLabel={t("actions.cancel")}
          />
        </form>
      </FormSheet>
    </Section>
  );
}
