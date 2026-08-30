import { AsyncSection, Button, Section, WarningBanner } from "@ketocare/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { api, errorMessageOf } from "../../lib/api";
import { BackupCodesPanel } from "../auth/BackupCodesPanel";

/** Ниже этого остатка о наборе пора напомнить: он кончается молча. */
const LOW_WATERMARK = 3;

/**
 * Резервные коды в своём профиле: сколько осталось и перевыпуск.
 *
 * Набор расходуется незаметно — человек вводит коды в те редкие дни, когда
 * телефона нет под рукой, и не считает их. Кончившийся набор обнаруживается в
 * тот момент, когда он нужен, то есть слишком поздно.
 *
 * Перевыпуск требует кода из приложения: иначе чужой доступ к незакрытой
 * вкладке позволял бы выпустить себе набор кодов на будущее — превратить
 * временный доступ в постоянный в обход второго фактора.
 */
export function BackupCodesSection() {
  const { t } = useTranslation("auth");
  const ids = useId();
  const queryClient = useQueryClient();

  const [code, setCode] = useState("");
  const [issued, setIssued] = useState<string[] | null>(null);

  const status = useQuery({
    queryKey: ["auth", "backup-codes"],
    // 409 у пользователя без второго фактора повтором не лечится.
    retry: false,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/auth/backup-codes", {});
      if (error || !data) throw error ?? new Error("Empty backup codes status");
      return data;
    },
  });

  const regenerate = useMutation({
    mutationFn: async (totpCode: string) => {
      const { data, error } = await api.POST("/api/v1/auth/backup-codes", {
        body: { totp_code: totpCode },
      });
      if (error || !data) throw error ?? new Error("Empty backup codes");
      return data;
    },
    onSuccess: async (data) => {
      setIssued(data.codes);
      setCode("");
      await queryClient.invalidateQueries({
        queryKey: ["auth", "backup-codes"],
      });
    },
  });

  const remaining = status.data?.remaining ?? 0;
  const total = status.data?.total ?? 0;

  return (
    <Section
      title={t("backupCodes.sectionTitle")}
      description={t("backupCodes.sectionIntro")}
    >
      {issued !== null ? (
        <BackupCodesPanel
          codes={issued}
          doneLabel={t("backupCodes.saved")}
          onDone={() => setIssued(null)}
        />
      ) : (
        <AsyncSection
          loading={status.isPending}
          skeleton={
            <p role="status" className="m-0 text-sm text-muted-foreground">
              {t("backupCodes.loading")}
            </p>
          }
          error={
            status.isError
              ? {
                  title: t("backupCodes.loadError"),
                  description:
                    errorMessageOf(status.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void status.refetch()}
          isEmpty={false}
          empty={null}
        >
          {remaining <= LOW_WATERMARK && (
            <WarningBanner level="warning" title={t("backupCodes.lowTitle")}>
              {t("backupCodes.lowBody", { count: remaining })}
            </WarningBanner>
          )}

          <p className="m-0 tabular-nums">
            {t("backupCodes.remaining", { remaining, total })}
          </p>

          <form
            noValidate
            className="flex flex-col gap-field"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim() === "") return;
              regenerate.mutate(code.trim());
            }}
          >
            <Field
              id={`${ids}-totp`}
              width="narrow"
              inputMode="numeric"
              autoComplete="one-time-code"
              label={t("backupCodes.totpLabel")}
              hint={t("backupCodes.totpHint")}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />

            {regenerate.isError && (
              <FormError>
                {errorMessageOf(regenerate.error) ??
                  t("common:errors.unexpected")}
              </FormError>
            )}

            <Button
              type="submit"
              variant="outline"
              className="min-h-touch self-start"
              disabled={regenerate.isPending}
            >
              {regenerate.isPending
                ? t("backupCodes.regenerating")
                : t("backupCodes.regenerate")}
            </Button>
          </form>
        </AsyncSection>
      )}
    </Section>
  );
}
