import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  Section,
  Skeleton,
  toast,
} from "@ketocare/ui";
import { MessageCircle, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import {
  useCreateLinkCodeMutation,
  useRevokeLinkMutation,
  useTelegramLinks,
} from "./useTelegramLinks";

interface Props {
  patientId: string;
  childName: string;
}

/**
 * Привязка Telegram-чата к ребёнку.
 *
 * Код показывается ОДИН раз и живёт 15 минут: он одноразовый и гасится первым
 * же `/start`. Поэтому он не кэшируется, не хранится и исчезает при уходе с
 * экрана — если родитель не успел, выпускается новый.
 *
 * Ссылка `t.me/<бот>?start=<код>` собирается сервером, потому что имя бота
 * знает только он (`BOT_USERNAME`). Если имя не настроено, сервер вернёт `null`
 * — тогда показывается один код, и переписать его можно руками: бот принимает
 * восьмизначный код отдельным сообщением, а не только по ссылке.
 */
export function TelegramPanel({ patientId, childName }: Props) {
  const { t } = useTranslation("telegram");

  const links = useTelegramLinks(patientId);
  const issue = useCreateLinkCodeMutation(patientId);
  const revoke = useRevokeLinkMutation(patientId);

  // Показываем только живые привязки: отозванная строка — это история, и её
  // место в журнале аудита, а не в списке действующих чатов.
  const active = (links.data ?? []).filter((link) => link.revoked_at === null);
  const code = issue.data;

  return (
    <div className="flex flex-col gap-block">
      <Section title={t("code.title")} density="compact">
        <p className="m-0 text-muted-foreground">{t("code.intro")}</p>

        {code === undefined ? (
          <Button
            type="button"
            className="min-h-touch self-start"
            disabled={issue.isPending}
            onClick={() => issue.mutate()}
          >
            <Plus aria-hidden="true" />
            {issue.isPending ? t("code.issuing") : t("code.issue")}
          </Button>
        ) : (
          <div className="flex flex-col gap-field">
            <p className="m-0 font-mono text-2xl tracking-[0.2em] tabular-nums">
              {code.code}
            </p>

            {code.deep_link === null ? (
              <p className="m-0 text-sm text-muted-foreground">
                {t("code.noDeepLink")}
              </p>
            ) : (
              <a
                className="text-primary underline underline-offset-4"
                href={code.deep_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("code.openBot")}
              </a>
            )}

            {/* Срок называется явно: код молча перестаёт работать через
                четверть часа, и без этой строки отказ бота выглядел бы
                поломкой, а не истечением. */}
            <p className="m-0 text-sm text-muted-foreground">
              {t("code.expiresAt", {
                time: new Date(code.expires_at).toLocaleTimeString("ru", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })}
            </p>

            <Button
              type="button"
              variant="outline"
              className="min-h-touch self-start"
              disabled={issue.isPending}
              onClick={() => issue.mutate()}
            >
              {t("code.reissue")}
            </Button>
          </div>
        )}

        {issue.isError && (
          <FormError>
            {errorMessageOf(issue.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}
      </Section>

      <Section title={t("links.title")}>
        {revoke.isError && (
          <FormError>
            {errorMessageOf(revoke.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <AsyncSection
          loading={links.isLoading}
          skeleton={<Skeleton className="h-16 w-full rounded-xl" />}
          error={
            links.isError
              ? {
                  title: t("links.loadError"),
                  description:
                    errorMessageOf(links.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void links.refetch()}
          isEmpty={active.length === 0}
          empty={
            <EmptyState
              icon={MessageCircle}
              title={t("links.empty")}
              description={t("links.emptyHint")}
            />
          }
        >
          <ul className="m-0 flex list-none flex-col gap-field p-0">
            {active.map((link) => (
              <li
                key={link.id}
                className="flex flex-wrap items-center gap-block rounded-xl border border-border p-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">
                    {t("links.chat", { id: link.chat_id })}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t("links.linkedAt", {
                      date: new Date(link.linked_at).toLocaleDateString("ru"),
                    })}
                  </span>
                </div>

                {/* Заголовок называет ребёнка: отвязка прекращает запись из
                    чата, и подтверждать надо конкретное действие, а не
                    абстрактное «вы уверены?» (правило П14 канона). */}
                <div className="ml-auto">
                  <ConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-touch"
                        disabled={revoke.isPending}
                      >
                        {t("links.revoke")}
                      </Button>
                    }
                    title={t("links.confirmRevoke.title", { name: childName })}
                    description={t("links.confirmRevoke.body")}
                    confirmLabel={t("links.confirmRevoke.confirm")}
                    cancelLabel={t("links.confirmRevoke.cancel")}
                    onConfirm={() =>
                      revoke.mutate(link.id, {
                        onSuccess: () => toast.success(t("links.revoked")),
                      })
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </AsyncSection>
      </Section>
    </div>
  );
}
