import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  formatOccurredAt,
  Section,
} from "@ketocare/ui";
import { KeyRound, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { QrCode } from "../../components/QrCode";
import { errorMessageOf } from "../../lib/api";
import { LinesSkeleton } from "../doctor/skeletons";
import {
  useAccessCodes,
  useIssueAccessCode,
  useRevokeAccessCode,
  type AccessCodeCreated,
} from "./useAccessCodes";

/**
 * Выдача доступа семье из карты ребёнка (ADR-0040).
 *
 * Врач нажимает одну кнопку и поворачивает экран к родителю: код крупно, QR на
 * бота, срок. Родитель ничего не набирает на приёме — он сканирует или
 * фотографирует.
 *
 * Код показывается не «один раз», в отличие от ссылки-приглашения: он хранится
 * открытым и виден в журнале, пока действует. Это осознанный размен (ADR-0040):
 * восемь знаков диктуют вслух, а защищают их неделя жизни и отзыв.
 */
export function AccessCodePanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation("access");
  const [issued, setIssued] = useState<AccessCodeCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const issue = useIssueAccessCode(patientId);
  const revoke = useRevokeAccessCode(patientId);
  const journal = useAccessCodes(patientId, true);

  async function handleIssue() {
    const created = await issue.mutateAsync().catch(() => null);
    if (created) {
      setIssued(created);
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-block">
      <Section
        title={t("panel.title")}
        description={t("panel.intro")}
        density="compact"
        action={
          <Button
            type="button"
            onClick={() => void handleIssue()}
            disabled={issue.isPending}
          >
            <KeyRound aria-hidden="true" />
            {issue.isPending
              ? t("panel.issuing")
              : issued === null
                ? t("panel.issue")
                : t("panel.issueAnother")}
          </Button>
        }
      >
        {issue.isError && (
          <p className="m-0 text-sm break-words text-destructive" role="alert">
            {errorMessageOf(issue.error) ?? t("panel.issueFailed")}
          </p>
        )}

        {issued !== null && (
          <div className="flex flex-col items-center gap-field">
            {/* QR ведёт в бота, если имя бота настроено, и на веб-активацию,
                если нет. Подпись обязана называть, что откроется: до этапа Б
                бот кода доступа не понимал, поле `deep_link` приходило пустым,
                и обе подписи говорили про страницу входа. */}
            <QrCode
              value={issued.deep_link ?? issued.join_url}
              alt={t("panel.qrAlt", { code: issued.code })}
            />
            <p className="m-0 text-center text-sm text-muted-foreground">
              {issued.deep_link === null
                ? t("panel.qrHintWeb")
                : t("panel.qrHintTelegram")}
            </p>

            <span className="text-sm font-medium">{t("panel.codeLabel")}</span>
            <output className="rounded-md bg-muted px-4 py-2 font-mono text-page-title tracking-widest">
              {issued.code}
            </output>

            <Button
              type="button"
              variant="ghost"
              className="min-h-touch"
              onClick={() => {
                void navigator.clipboard?.writeText(issued.code);
                setCopied(true);
              }}
            >
              <Copy aria-hidden="true" />
              {copied ? t("panel.copied") : t("panel.copy")}
            </Button>

            <p className="m-0 text-sm text-muted-foreground">
              {t("panel.expires", {
                date: formatOccurredAt(new Date(issued.expires_at)),
              })}
            </p>
            <p className="m-0 text-sm break-all text-muted-foreground">
              {t("panel.joinUrl", { url: issued.join_url })}
            </p>
            {/* Правило клиники, кому давать код, система не проверяет — но
                назвать его на экране обязана (ADR-0040, решение 6). */}
            <p className="m-0 text-center text-sm text-muted-foreground">
              {t("panel.whoMay")}
            </p>
          </div>
        )}
      </Section>

      <Section title={t("panel.journalTitle")} density="compact" level={3}>
        <AsyncSection
          loading={journal.isPending}
          skeleton={
            <LinesSkeleton label={t("panel.journalLoading")} lines={2} />
          }
          error={
            journal.isError
              ? {
                  title: t("panel.journalError"),
                  description:
                    errorMessageOf(journal.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void journal.refetch()}
          isEmpty={(journal.data ?? []).length === 0}
          empty={
            <EmptyState
              icon={KeyRound}
              title={t("panel.journalEmpty")}
              description={t("panel.journalEmptyDescription")}
            />
          }
        >
          <ul className="m-0 flex list-none flex-col gap-field p-0">
            {(journal.data ?? []).map((row) => (
              <li
                key={row.code}
                className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
              >
                <span className="font-mono tracking-widest">{row.code}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`panel.status.${row.status}`)}
                </span>
                {row.issued_by_name !== null &&
                  row.issued_by_name !== undefined && (
                    <span className="text-sm text-muted-foreground">
                      {t("panel.issuedBy", { name: row.issued_by_name })}
                    </span>
                  )}
                {row.used_by_name !== null &&
                  row.used_by_name !== undefined && (
                    <span className="text-sm text-muted-foreground">
                      {t("panel.usedBy", { name: row.used_by_name })}
                    </span>
                  )}

                {row.status === "pending" && (
                  <ConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto min-h-touch"
                      >
                        {t("panel.revoke")}
                      </Button>
                    }
                    // Заголовок называет код: «отозвать?» без объекта — вопрос
                    // без предмета, а кодов в журнале бывает несколько.
                    title={t("panel.revokeTitle", { code: row.code })}
                    description={t("panel.revokeDescription")}
                    confirmLabel={t("panel.revoke")}
                    cancelLabel={t("common:actions.cancel")}
                    onConfirm={() => {
                      void revoke.mutateAsync(row.code).catch(() => null);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </AsyncSection>
      </Section>
    </div>
  );
}
