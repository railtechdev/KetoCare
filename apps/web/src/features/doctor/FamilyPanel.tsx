import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  FormSheet,
  Section,
  formatOccurredAt,
  toast,
} from "@ketocare/ui";
import { Mail, MessageCircle, Phone, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { AccessCodePanel } from "../access/AccessCodePanel";
import {
  useRevokeLinkMutation,
  useTelegramLinks,
} from "../telegram/useTelegramLinks";
import { useFamily } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";
import { isCareRole } from "./types";

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
 * **Доступ семье выдаётся отсюда** (ADR-0040): кнопка открывает панель с кодом
 * и QR. Прежде здесь стояло приглашение по почте — врачу приходилось набирать
 * чужой адрес при семье, а семья на приёме не всегда готова разбираться. Код
 * несёт ребёнка, поэтому двойник карты невозможен, а второй взрослый получает
 * такой же код, а не отдельный механизм.
 *
 * Кнопка — только у специалиста: семья доступа не раздаёт, и сервер ответил бы
 * 403 (правило П3 канона).
 *
 * **Подключённые устройства семьи и их отключение — тоже здесь.** Родитель из
 * Telegram веб-кабинета не имеет, а отключить потерянный телефон можно было
 * только оттуда: путь шёл «родитель → врач → у врача нет кнопки →
 * администратор отключает всю учётную запись», и всё это время старое
 * устройство писало в дневник ребёнка. Врач — единственный, кто выдаёт доступ;
 * логично, что он же его и снимает. Право в API у него было и до экрана.
 */
export function FamilyPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();
  const family = useFamily(patientId);
  const links = useTelegramLinks(patientId);
  const revoke = useRevokeLinkMutation(patientId);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Подпись одна: «родителя» верно и при пустой семье, и при одном родителе.
  // Две подписи по числу родителей меняли ширину кнопки после загрузки семьи.
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
            {t("family.grantAccess")}
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

              {/* Почты может не быть вовсе: родитель из Telegram её не заводил
                  (ADR-0040). Безусловная кнопка давала бы `mailto:null` —
                  пустую ссылку ровно в панели контактов, ради которой панель и
                  делалась (ADR-0011). */}
              {member.email !== null && (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="min-h-touch"
                >
                  <a href={`mailto:${member.email}`}>
                    <Mail aria-hidden="true" />
                    {member.email}
                  </a>
                </Button>
              )}

              <Devices
                memberId={member.id}
                memberName={member.full_name}
                links={links.data}
                loadFailed={links.isError}
                canRevoke={canInvite}
                revoking={revoke.isPending}
                onRevoke={(linkId) =>
                  revoke.mutate(linkId, {
                    onSuccess: () => toast.success(t("family.devices.revoked")),
                  })
                }
              />
            </li>
          ))}
        </ul>
      </AsyncSection>

      {canInvite && (
        <FormSheet
          closeLabel={t("common:actions.close")}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          title={t("family.grantAccessTitle")}
          description={t("family.grantAccessIntro")}
        >
          <AccessCodePanel patientId={patientId} />
        </FormSheet>
      )}
    </Section>
  );
}

/**
 * Устройства одного родителя: живые привязки Telegram и кнопка отключить.
 *
 * Идентификатор чата врачу не показывается — ему говорит дата подключения, а
 * число ни о чём. Отозванные строки не показываются: это история, и её место в
 * журнале аудита. Пока список едет, строка молчит — устройства второстепенны
 * рядом с контактами, и скелетон на каждого родителя мельтешил бы.
 */
function Devices({
  memberId,
  memberName,
  links,
  loadFailed,
  canRevoke,
  revoking,
  onRevoke,
}: {
  memberId: string;
  memberName: string;
  links:
    | {
        id: string;
        parent_id: string;
        linked_at: string;
        revoked_at: string | null;
      }[]
    | undefined;
  loadFailed: boolean;
  canRevoke: boolean;
  revoking: boolean;
  onRevoke: (linkId: string) => void;
}) {
  const { t } = useTranslation("doctor");

  if (loadFailed) {
    return (
      <span className="basis-full text-sm text-destructive">
        {t("family.devices.loadError")}
      </span>
    );
  }
  if (links === undefined) return null;

  const mine = links.filter(
    (link) => link.parent_id === memberId && link.revoked_at === null,
  );
  if (mine.length === 0) {
    return (
      <span className="basis-full text-sm text-muted-foreground">
        {t("family.devices.none")}
      </span>
    );
  }

  return (
    <ul className="m-0 flex basis-full list-none flex-col gap-1 p-0">
      {mine.map((link) => (
        <li
          key={link.id}
          className="flex flex-wrap items-center gap-field text-sm"
        >
          <MessageCircle aria-hidden="true" className="size-4" />
          <span>
            {t("family.devices.connected", {
              date: formatOccurredAt(new Date(link.linked_at)),
            })}
          </span>
          {/* Заголовок называет родителя: отключение прекращает запись с его
              устройства, и подтверждать надо конкретное действие, а не
              абстрактное «вы уверены?» (правило П14 канона). */}
          {canRevoke && (
            <ConfirmDialog
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-touch"
                  disabled={revoking}
                >
                  {t("family.devices.revoke")}
                </Button>
              }
              title={t("family.devices.confirmRevoke.title", {
                name: memberName,
              })}
              description={t("family.devices.confirmRevoke.body")}
              confirmLabel={t("family.devices.confirmRevoke.confirm")}
              cancelLabel={t("family.devices.confirmRevoke.cancel")}
              onConfirm={() => onRevoke(link.id)}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
