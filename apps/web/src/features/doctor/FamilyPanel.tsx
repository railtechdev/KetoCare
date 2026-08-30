import { AsyncSection, Button, EmptyState, Section } from "@ketocare/ui";
import { Mail, Phone, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useFamily } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";

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
 */
export function FamilyPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const family = useFamily(patientId);

  return (
    <Section
      title={t("family.title")}
      description={t("family.intro")}
      density="compact"
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
    </Section>
  );
}
