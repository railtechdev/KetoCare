import {
  AsyncSection,
  Button,
  EmptyState,
  FormSheet,
  Section,
} from "@ketocare/ui";
import { Mail, Phone, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { InviteForm } from "../invitations/InvitePanel";
import type { Role } from "../invitations/useInvitations";
import { useFamily } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";
import { isCareRole } from "./types";

const PARENT_ONLY: readonly Role[] = ["parent"];

/**
 * Кто ведёт ребёнка дома (ADR-0011).
 *
 * Красный флаг «семья молчит N дней» стоял первой строкой списка пациентов, а
 * следующего шага не существовало: врач открывал карту, находил пустые
 * дневники — и ни телефона, ни почты, ни даже имени того, кто ведёт ребёнка.
 * Триаж заканчивался констатацией проблемы.
 *
 * Телефон необязателен (`users.phone` nullable). Когда его нет, почта остаётся
 * единственным каналом, и показывать её вместо прочерка обязательно: прочерк
 * читается как «связаться нельзя», хотя канал есть.
 *
 * Ссылки `tel:` и `mailto:`, а не текст для переписывания: врач звонит с того
 * же устройства, на котором смотрит карту, и переписывание номера — лишний шаг
 * и лишняя опечатка.
 *
 * **Второго родителя приглашают отсюда** (ответ клиники на вопрос 33,
 * ADR-0032). Приглашение из списка пациентов зовёт первого родителя, который
 * сам заводит ребёнка; позванный так второй родитель заводил двойника. Здесь
 * приглашение несёт ребёнка, и принявший его сразу видит того же. Кнопка —
 * только у специалиста: семья приглашать не может, и сервер ответил бы 403
 * (правило П3 канона).
 */
export function FamilyPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();
  const family = useFamily(patientId);
  const [inviteOpen, setInviteOpen] = useState(false);

  const canInvite = isCareRole(session?.role);

  return (
    <Section
      title={t("family.title")}
      description={t("family.intro")}
      density="compact"
      action={
        canInvite && (
          <Button type="button" onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden="true" />
            {t("family.invite")}
          </Button>
        )
      }
    >
      <AsyncSection
        loading={family.isPending}
        skeleton={<LinesSkeleton label={t("family.loading")} lines={2} />}
        error={
          family.isError
            ? {
                title: t("family.loadError"),
                description:
                  errorMessageOf(family.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void family.refetch()}
        isEmpty={(family.data ?? []).length === 0}
        empty={
          <EmptyState
            icon={Users}
            title={t("family.empty")}
            description={t("family.emptyDescription")}
          />
        }
      >
        <ul className="m-0 flex list-none flex-col gap-field p-0">
          {(family.data ?? []).map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
            >
              <span className="min-w-0 flex-1 break-words">
                {member.full_name}
              </span>

              {member.phone !== null && (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="min-h-touch"
                >
                  <a href={`tel:${member.phone}`}>
                    <Phone aria-hidden="true" />
                    {member.phone}
                  </a>
                </Button>
              )}

              <Button asChild variant="ghost" size="sm" className="min-h-touch">
                <a href={`mailto:${member.email}`}>
                  <Mail aria-hidden="true" />
                  {member.email}
                </a>
              </Button>
            </li>
          ))}
        </ul>
      </AsyncSection>

      {canInvite && (
        <FormSheet
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          title={t("family.inviteTitle")}
          description={t("family.inviteIntro")}
        >
          <InviteForm roles={PARENT_ONLY} patientId={patientId} />
        </FormSheet>
      )}
    </Section>
  );
}
