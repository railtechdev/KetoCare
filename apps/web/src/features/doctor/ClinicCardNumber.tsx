import { zodResolver } from "@hookform/resolvers/zod";
import { Button, FormFooter, FormSheet, toast } from "@ketocare/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { api, errorMessageOf } from "../../lib/api";
import { isValidCardNumber, normalizeCardNumber } from "../child/childSchemas";
import type { Patient } from "./types";

const schema = z.object({ number: z.string().refine(isValidCardNumber) });
type Values = z.infer<typeof schema>;

function useSetCardNumber(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (number: string | null): Promise<Patient> => {
      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/clinic-card",
        {
          params: { path: { patient_id: patientId } },
          body: { clinic_card_number: number },
        },
      );
      if (error || !data) throw error ?? new Error("Empty patient response");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["patients"] });
      void queryClient.invalidateQueries({ queryKey: ["patient", patientId] });
    },
  });
}

/**
 * Номер карты клиники в профиле пациента (ADR-0092): значение и действие рядом.
 *
 * Отдельной формой, а не полем профиля: профиль правит и семья, а номер —
 * только ведущий специалист (сервер проверяет роль сам).
 */
export function ClinicCardNumber({ patient }: { patient: Patient }) {
  const { t } = useTranslation("doctor");
  const [open, setOpen] = useState(false);
  const number = patient.clinic_card_number ?? null;

  return (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className={number === null ? "text-muted-foreground" : undefined}>
          {number ?? t("card.clinicCard.none")}
        </span>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          onClick={() => setOpen(true)}
        >
          {number === null
            ? t("card.clinicCard.set")
            : t("card.clinicCard.change")}
        </Button>
      </span>
      <FormSheet
        closeLabel={t("common:actions.close")}
        open={open}
        onOpenChange={setOpen}
        title={t("card.clinicCard.title", { name: patient.full_name })}
      >
        {open && (
          <CardNumberForm patient={patient} onDone={() => setOpen(false)} />
        )}
      </FormSheet>
    </>
  );
}

function CardNumberForm({
  patient,
  onDone,
}: {
  patient: Patient;
  onDone: () => void;
}) {
  const { t } = useTranslation("doctor");
  const id = useId();
  const save = useSetCardNumber(patient.id);
  const {
    register,
    handleSubmit,
    formState: { errors, submitCount },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { number: patient.clinic_card_number ?? "" },
  });
  const error = errors.number && t("card.clinicCard.error");

  return (
    <form
      noValidate
      className="flex flex-col gap-section"
      onSubmit={handleSubmit((values) =>
        save.mutate(normalizeCardNumber(values.number), {
          onSuccess: () => {
            toast.success(t("card.clinicCard.saved"));
            onDone();
          },
        }),
      )}
    >
      <FormErrorSummary
        items={errorSummaryItems(submitCount, [[id, error]])}
        focusKey={submitCount}
      />
      <p className="m-0">{t("card.clinicCard.intro")}</p>
      <Field
        id={id}
        width="medium"
        optional
        label={t("card.clinicCard.field")}
        hint={t("card.clinicCard.hint")}
        error={error}
        {...register("number")}
      />
      {save.isError && (
        <FormError>
          {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}
      <FormFooter
        submitLabel={t("common:actions.save")}
        pendingLabel={t("common:actions.saving")}
        pending={save.isPending}
        cancelLabel={t("common:actions.cancel")}
        onCancel={onDone}
      />
    </form>
  );
}
