import {
  ActionReason,
  Button,
  ConfirmDialog,
  Section,
  toast,
} from "@ketocare/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import type { AdminUser } from "./types";
import { useAdminUsers, useTransferCareMutation } from "./useAdminUsers";

const CARE_ROLES = new Set(["doctor", "dietitian"]);

/**
 * «Передать пациентов» — выход из тупика ушедшего специалиста (ADR-0045).
 *
 * Прежде отключить специалиста, который один ведёт детей, было нельзя, а
 * передать их мог только он сам. Теперь администратор выбирает коллегу, и все
 * дети переходят к нему одним действием; самих детей администратор не видит —
 * только их число.
 */
export function CareTransferPanel({ user }: { user: AdminUser }) {
  const { t } = useTranslation("admin");
  const selectId = useId();
  const [toUserId, setToUserId] = useState("");
  const users = useAdminUsers();
  const transfer = useTransferCareMutation();

  const colleagues = (users.data?.items ?? []).filter(
    (candidate) =>
      candidate.id !== user.id &&
      candidate.is_active &&
      CARE_ROLES.has(candidate.role),
  );
  const target = colleagues.find((candidate) => candidate.id === toUserId);
  const count = user.sole_patients ?? 0;
  const reasonId = `${selectId}-reason`;
  // Причина отключённой кнопки (П44) — по одной, в порядке устранения: сначала
  // есть ли кому передать вообще, потом выбран ли коллега.
  const reason =
    transfer.isPending || target !== undefined
      ? null
      : colleagues.length === 0 && users.isSuccess
        ? t("users.transfer.noColleagues")
        : t("users.transfer.chooseFirst");

  return (
    <Section
      title={t("users.transfer.title")}
      description={t("users.transfer.intro", { count })}
      density="compact"
      level={3}
    >
      <SelectField
        id={selectId}
        width="medium"
        label={t("users.transfer.to")}
        value={toUserId}
        onChange={(event) => setToUserId(event.target.value)}
      >
        <option value="">{t("users.transfer.choose")}</option>
        {colleagues.map((colleague) => (
          <option key={colleague.id} value={colleague.id}>
            {colleague.full_name} · {t(`common:roles.${colleague.role}`)}
          </option>
        ))}
      </SelectField>

      {transfer.isError && (
        <FormError>
          {errorMessageOf(transfer.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <ConfirmDialog
        trigger={
          <Button
            type="button"
            className="min-h-touch self-start"
            disabled={target === undefined || transfer.isPending}
            aria-describedby={reasonId}
          >
            {t("users.transfer.action")}
          </Button>
        }
        title={t("users.transfer.confirmTitle", {
          from: user.full_name,
          to: target?.full_name ?? "",
        })}
        description={t("users.transfer.confirmBody")}
        confirmLabel={t("users.transfer.action")}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={() => {
          if (target === undefined) return;
          transfer.mutate(
            { fromUserId: user.id, toUserId: target.id },
            {
              onSuccess: (result) =>
                toast.success(
                  t("users.transfer.done", {
                    count: result.transferred,
                    name: target.full_name,
                  }),
                ),
            },
          );
        }}
      />
      <ActionReason id={reasonId}>{reason}</ActionReason>
    </Section>
  );
}
