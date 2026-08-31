import {
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

import { SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { useCareTeamMutations } from "./doctorMutations";
import { useCareTeam, useColleagues } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";
import { isCareRole } from "./types";

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
 * Снять последнего специалиста сервер не даёт и объясняет это по-русски —
 * дублировать проверку на клиенте незачем, она разошлась бы с серверной.
 */
export function CareTeamPanel({
  patientId,
  title,
  description,
}: {
  patientId: string;
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

  // Справочник персонала сервер отдаёт только doctor и dietitian. Запрашивать
  // его иначе — значит открывать заведомый 403 (правило П3 канона: действия,
  // которых нет, не показываются).
  const canWrite = isCareRole(session?.role);

  const team = useCareTeam(patientId);
  const colleagues = useColleagues(canWrite && formOpen);
  const { add, remove } = useCareTeamMutations(patientId);

  const teamIds = new Set((team.data ?? []).map((member) => member.id));
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
        loading={team.isPending}
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
                      onSuccess: () => toast.success(t("careTeam.removed")),
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      </AsyncSection>

      {/* Ошибка снятия — не ошибка загрузки: повторять нечего. Так сервер
          сообщает и о запрете снять последнего специалиста. */}
      {remove.isError && (
        <FormError>
          {errorMessageOf(remove.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <FormSheet
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
          className="flex flex-col gap-block"
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
          <SelectField
            id={`${ids}-colleague`}
            width="wide"
            label={t("careTeam.colleague")}
            hint={t("careTeam.colleagueHint")}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">{t("careTeam.colleaguePlaceholder")}</option>
            {candidates.map((colleague) => (
              <option key={colleague.id} value={colleague.id}>
                {colleague.full_name} · {t(`common:roles.${colleague.role}`)}
              </option>
            ))}
          </SelectField>

          {colleagues.isError && (
            <FormError>
              {errorMessageOf(colleagues.error) ??
                t("common:errors.unexpected")}
            </FormError>
          )}
          {add.isError && (
            <FormError>
              {errorMessageOf(add.error) ?? t("common:errors.unexpected")}
            </FormError>
          )}

          <FormFooter
            submitLabel={t("careTeam.addAction")}
            pendingLabel={t("careTeam.adding")}
            pending={add.isPending}
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
