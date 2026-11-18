import { zodResolver } from "@hookform/resolvers/zod";
import {
  ConfirmDialog,
  FactList,
  FormFooter,
  FormSheet,
  parseDateInput,
  toast,
} from "@ketocare/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { api, errorMessageOf } from "../../lib/api";
import { formatIsoDate } from "./dates";
import type { Patient } from "./types";

const identitySchema = z.object({
  birthDate: z.string().refine((value) => parseDateInput(value) !== null),
  sex: z.enum(["m", "f"]),
});

type IdentityValues = z.infer<typeof identitySchema>;

function useCorrectIdentity(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: IdentityValues): Promise<Patient> => {
      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/identity",
        {
          params: { path: { patient_id: patientId } },
          body: { birth_date: values.birthDate, sex: values.sex },
        },
      );
      if (error || !data) throw error ?? new Error("Empty identity response");
      return data;
    },
    onSuccess: () => {
      // Age feeds the card header, the overview, growth and prescription hints.
      void queryClient.invalidateQueries({ queryKey: ["patients"] });
      void queryClient.invalidateQueries({ queryKey: ["patient", patientId] });
    },
  });
}

/**
 * Correcting the birth date and sex — the treating doctor only (ADR-0090,
 * UI audit of 2026-11-18, Р1).
 *
 * Not part of the profile form: there the two fields are fixed, and a typo in
 * them used to be a dead end. Here the doctor sees what changes before it is
 * saved, and the saved prescription is named as the thing to check: its
 * versions are append-only and do not follow the new age by themselves.
 */
export function IdentityCorrection({
  patient,
  open,
  onOpenChange,
}: {
  patient: Patient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("doctor");
  const correct = useCorrectIdentity(patient.id);
  const [pending, setPending] = useState<IdentityValues | null>(null);

  return (
    <FormSheet
      closeLabel={t("common:actions.close")}
      open={open}
      onOpenChange={(next) => {
        if (!next) correct.reset();
        onOpenChange(next);
      }}
      title={t("identity.title", { name: patient.full_name })}
    >
      {open && (
        <IdentityForm
          patient={patient}
          pending={correct.isPending}
          error={correct.error}
          onCancel={() => onOpenChange(false)}
          onSubmit={setPending}
        />
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null);
        }}
        title={t("identity.confirm.title")}
        description={t("identity.confirm.description")}
        confirmLabel={t("identity.confirm.action")}
        cancelLabel={t("identity.confirm.cancel")}
        destructive={false}
        onConfirm={() => {
          if (pending === null) return;
          correct.mutate(pending, {
            onSuccess: () => {
              toast.success(t("identity.saved"), {
                description: t("identity.checkPrescription"),
              });
              onOpenChange(false);
            },
          });
          setPending(null);
        }}
      >
        {pending !== null && (
          <FactList>
            <dt className="text-muted-foreground">
              {t("identity.fields.birthDate")}
            </dt>
            <dd className="m-0 tabular-nums">
              {formatIsoDate(pending.birthDate)}
              {pending.birthDate !== patient.birth_date &&
                ` ${t("identity.was", { value: formatIsoDate(patient.birth_date) })}`}
            </dd>
            <dt className="text-muted-foreground">
              {t("identity.fields.sex")}
            </dt>
            <dd className="m-0">
              {t(`card.sexValue.${pending.sex}`)}
              {pending.sex !== patient.sex &&
                ` ${t("identity.was", { value: t(`card.sexValue.${patient.sex}`) })}`}
            </dd>
          </FactList>
        )}
      </ConfirmDialog>
    </FormSheet>
  );
}

function IdentityForm({
  patient,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  patient: Patient;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (values: IdentityValues) => void;
}) {
  const { t } = useTranslation("doctor");
  const ids = useId();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, submitCount },
  } = useForm<IdentityValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      birthDate: patient.birth_date,
      sex: patient.sex as "m" | "f",
    },
  });

  const birthDateError = errors.birthDate && t("identity.errors.birthDate");
  const sexError = errors.sex && t("identity.errors.sex");
  const unchanged =
    watch("birthDate") === patient.birth_date && watch("sex") === patient.sex;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-section"
    >
      <FormErrorSummary
        items={errorSummaryItems(submitCount, [
          [`${ids}-birth`, birthDateError],
          [`${ids}-sex`, sexError],
        ])}
        focusKey={submitCount}
      />
      <p className="m-0">{t("identity.intro")}</p>
      <Field
        id={`${ids}-birth`}
        width="date"
        type="date"
        label={t("identity.fields.birthDate")}
        error={birthDateError}
        {...register("birthDate")}
      />
      <SelectField
        id={`${ids}-sex`}
        width="medium"
        label={t("identity.fields.sex")}
        error={sexError}
        {...register("sex")}
      >
        <option value="m">{t("card.sexValue.m")}</option>
        <option value="f">{t("card.sexValue.f")}</option>
      </SelectField>
      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}
      <FormFooter
        submitLabel={t("identity.submit")}
        pendingLabel={t("identity.submitPending")}
        pending={pending}
        disabled={unchanged}
        reason={unchanged ? t("identity.unchangedReason") : undefined}
        cancelLabel={t("identity.cancel")}
        onCancel={onCancel}
      />
    </form>
  );
}
