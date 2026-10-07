import {
  AsyncSection,
  Button,
  toast,
  ConfirmDialog,
  EmptyState,
  formatOccurredAt,
  Section,
} from "@ketocare/ui";
import { KeyRound, Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { copyText } from "../../lib/clipboard";
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
import { queryState } from "../../lib/queryState";

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
 *
 * **Выдаёт и родитель** (ADR-0042) — второму взрослому, который ухаживает за
 * ребёнком вместе с ним. Механика та же, меняются только слова: врач говорит о
 * «семье», родитель — о «другом взрослом» (`audience`). Назначение кода
 * передаётся явно в обоих случаях: этот экран выдаёт доступ, а не подключает
 * свой чат, и полагаться на выбор сервера по роли здесь незачем.
 */
export function AccessCodePanel({
  patientId,
  audience,
}: {
  patientId: string;
  audience: "specialist" | "parent";
}) {
  const { t } = useTranslation("access");
  const [issued, setIssued] = useState<AccessCodeCreated | null>(null);
  const [copied, setCopied] = useState(false);
  // Ключи с голосом выдающего; общие — без префикса.
  const voice = (key: string) => t(`panel.${audience}.${key}`);

  const issue = useIssueAccessCode(patientId, "family_member");
  const revoke = useRevokeAccessCode(patientId);
  const journal = useAccessCodes(patientId, true);

  /**
   * Приглашение целиком: что сделать по шагам, ссылка и код на случай, если
   * ссылка не откроется. Восемь знаков без объяснений бабушке не помогут —
   * а именно их раньше копировала единственная кнопка (аудит пути, 02.10.2026).
   */
  function invitationText(created: AccessCodeCreated): string {
    const date = formatOccurredAt(new Date(created.expires_at));
    return created.deep_link === null
      ? t("panel.share.textWeb", {
          url: created.join_url,
          code: created.code,
          date,
        })
      : t("panel.share.textTelegram", {
          link: created.deep_link,
          code: created.code,
          date,
        });
  }

  async function handleShare(created: AccessCodeCreated) {
    const text = invitationText(created);
    // Системное «Поделиться» на телефоне открывает тот же список чатов, что
    // и в любом другом приложении, — искать, куда вставлять, не нужно.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // Закрыли окно или браузер отказал — падаем в копирование ниже.
      }
    }
    if (await copyText(text)) toast.success(t("panel.share.copied"));
    else toast.error(t("panel.share.failed"));
  }

  async function handleIssue() {
    const created = await issue.mutateAsync().catch(() => null);
    if (created) {
      setIssued(created);
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-section">
      <Section
        title={voice("title")}
        description={voice("intro")}

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
                ? voice("issue")
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
                ? voice("qrHintWeb")
                : voice("qrHintTelegram")}
            </p>

            <span className="text-sm font-medium">{voice("codeLabel")}</span>
            <output className="rounded-md bg-muted px-4 py-2 font-mono text-page-title tracking-widest">
              {issued.code}
            </output>

            <Button
              type="button"
              className="min-h-touch"
              onClick={() => void handleShare(issued)}
            >
              <Share2 aria-hidden="true" />
              {t("panel.share.action")}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="min-h-touch"
              onClick={() => {
                // «Скопировано» — только после подтверждения браузера: на
                // отказ называется выход, а не обещается то, чего не было.
                void copyText(issued.code).then((ok) => {
                  setCopied(ok);
                  if (!ok) toast.error(t("common:clipboard.failed"));
                });
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
            {/* Правило, кому давать код, система не проверяет — но назвать
                его на экране обязана (ADR-0040, решение 6). Родителю оно
                звучит иначе: законный представитель он сам, и передавая код,
                он и даёт то самое согласие. */}
            <p className="m-0 text-center text-sm text-muted-foreground">
              {voice("whoMay")}
            </p>
          </div>
        )}
      </Section>

      <Section title={t("panel.journalTitle")} level={3}>
        <AsyncSection
          {...queryState(journal)}
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
              description={voice("journalEmptyDescription")}
            />
          }
        >
          <ul className="m-0 flex list-none flex-col gap-field p-0">
            {(journal.data ?? []).map((row, index) => (
              <li
                // Код бывает скрыт (чужой код своего чата), и ключом служит
                // время выпуска с позицией — строки журнала не переставляются.
                key={`${row.created_at}-${index}`}
                className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
              >
                {/* Чужой код своего чата сервер не отдаёт: по нему вошедший
                    вёл бы дневник от имени выпустившего (ADR-0042). */}
                <span className="font-mono tracking-widest">
                  {row.code ?? t("panel.hiddenCode")}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`panel.status.${row.status}`)}
                </span>
                {/* Журнал общий: в нём и коды своего чата, которые родитель
                    выпускает в разделе «Telegram». Без пометки они читались бы
                    как выданный кому-то доступ. */}
                <span className="text-sm text-muted-foreground">
                  {t(`panel.purpose.${row.purpose}`)}
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

                {row.status === "pending" && row.code !== null && (
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
                    title={t("panel.revokeTitle", { code: row.code ?? "" })}
                    description={t("panel.revokeDescription")}
                    confirmLabel={t("panel.revoke")}
                    cancelLabel={t("common:actions.cancel")}
                    // Итог — тостом в обе стороны: отказ, проглоченный
                    // молча, оставлял код действующим, а врач считал его
                    // отозванным.
                    onConfirm={() => {
                      const code = row.code;
                      if (code === null) return;
                      revoke.mutate(code, {
                        onSuccess: () =>
                          toast.success(t("panel.revokedToast", { code })),
                        onError: (error) =>
                          toast.error(
                            errorMessageOf(error) ?? t("panel.revokeFailed"),
                          ),
                      });
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
