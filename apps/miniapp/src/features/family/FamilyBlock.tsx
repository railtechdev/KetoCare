import {
  AsyncSection,
  Button,
  ConfirmDialog,
  Section,
  formatOccurredAt,
  toast,
} from "@ketocare/ui";
import { Send, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { shareToTelegram } from "../../lib/telegram";
import type { Session } from "../session/useSession";
import {
  type Invitation,
  useFamily,
  useInvite,
  useRemoveMember,
} from "./useFamily";

/**
 * «Близкие» — кто вместе с семьёй ведёт ребёнка, и как позвать ещё одного
 * (ADR-0042, ADR-0043).
 *
 * Здесь, а не только в кабинете: семья из Telegram кабинета не имеет, и
 * пригласить бабушку ей было нечем — восемь шагов на двух устройствах. Как у
 * Apple Health и Medisafe, приглашение уходит из того же приложения, обычным
 * сообщением в обычный чат: родитель жмёт «Отправить», выбирает бабушку в
 * своём списке, а бабушке остаётся нажать ссылку.
 *
 * «Выйти» себе здесь не предлагается: приложение открыто привязкой этого
 * чата, и выход оборвал бы его посреди экрана. Уйти можно в кабинете или
 * попросив врача.
 */
export function FamilyBlock({ session }: { session: Session }) {
  const { t } = useTranslation();
  const family = useFamily(session.patientId);
  const invite = useInvite(session.patientId);
  const remove = useRemoveMember(session.patientId);

  const members = family.data ?? [];

  return (
    <Section title={t("family.title")} density="compact">
      <p className="m-0 text-muted-foreground">{t("family.intro")}</p>

      <AsyncSection
        loading={family.isPending}
        skeleton={null}
        error={
          family.isError
            ? {
                title: t("family.loadError"),
                description:
                  errorMessageOf(family.error) ?? t("family.loadErrorHint"),
              }
            : null
        }
        // Без сети об этом уже говорит сводка выше: вторая такая же строка
        // на одном экране — шум, а не объяснение.
        waiting={null}
        retryLabel={t("actions.retry")}
        onRetry={() => void family.refetch()}
        isEmpty={false}
        empty={null}
      >
        <ul className="m-0 flex list-none flex-col gap-field p-0">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="break-words">
                  {member.is_me
                    ? t("family.me", { name: member.full_name })
                    : member.full_name}
                </span>
                {member.invited_by_name !== null &&
                  member.invited_by_name !== undefined && (
                    <span className="text-sm text-muted-foreground">
                      {t("family.invitedBy", { name: member.invited_by_name })}
                    </span>
                  )}
              </span>

              {member.can_remove && !member.is_me && (
                <ConfirmDialog
                  trigger={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-touch"
                      disabled={remove.isPending}
                    >
                      {t("family.remove")}
                    </Button>
                  }
                  title={t("family.removeTitle", { name: member.full_name })}
                  description={t("family.removeBody")}
                  confirmLabel={t("family.remove")}
                  cancelLabel={t("actions.cancel")}
                  onConfirm={() =>
                    remove.mutate(member.id, {
                      onSuccess: () =>
                        toast.success(
                          t("family.removed", { name: member.full_name }),
                        ),
                      onError: (error) =>
                        toast.error(
                          errorMessageOf(error) ?? t("family.removeFailed"),
                        ),
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      </AsyncSection>

      {invite.data === undefined ? (
        <Button
          type="button"
          className="min-h-touch self-start"
          disabled={invite.isPending}
          onClick={() => invite.mutate()}
        >
          <UserPlus aria-hidden="true" />
          {invite.isPending ? t("family.inviting") : t("family.invite")}
        </Button>
      ) : (
        <InvitationReady invitation={invite.data} />
      )}

      {invite.isError && (
        <p role="alert" className="m-0 text-destructive">
          {errorMessageOf(invite.error) ?? t("family.inviteFailed")}
        </p>
      )}
    </Section>
  );
}

/**
 * Приглашение готово: одна главная кнопка — отправить, и код на случай, если
 * человек рядом или ссылка не откроется.
 *
 * Шаги для получателя лежат в самом сообщении, а не здесь: читать их будет
 * бабушка, а не тот, кто нажал «Отправить».
 */
function InvitationReady({ invitation }: { invitation: Invitation }) {
  const { t } = useTranslation();
  const date = formatOccurredAt(new Date(invitation.expires_at));
  const link = invitation.deep_link ?? invitation.join_url;
  const text =
    invitation.deep_link === null
      ? t("family.messageWeb", { code: invitation.code, date })
      : t("family.messageTelegram", { code: invitation.code, date });

  return (
    <div className="flex flex-col gap-field">
      <p className="m-0">{t("family.readyIntro")}</p>
      <Button
        type="button"
        className="min-h-touch self-start"
        onClick={() => shareToTelegram(link, text)}
      >
        <Send aria-hidden="true" />
        {t("family.send")}
      </Button>
      <p className="m-0 text-sm text-muted-foreground">{t("family.nearby")}</p>
      <output className="self-start rounded-md bg-muted px-4 py-2 font-mono text-page-title tracking-widest">
        {invitation.code}
      </output>
      <p className="m-0 text-sm text-muted-foreground">
        {t("family.expires", { date })}
      </p>
      <p className="m-0 text-sm text-muted-foreground">{t("family.trust")}</p>
    </div>
  );
}
