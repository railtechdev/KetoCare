import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import type { DishRow } from "./types";
import { useSaveDishMutation } from "./useCalcMutations";
import { FIELD_CONTROL } from "../../components/Field";

interface Props {
  patientId: string | null;
  rows: DishRow[];
}

/** «Сохранить как моё блюдо» (раздел 8.3 ТЗ). */
export function SaveDishForm({ patientId, rows }: Props) {
  const { t } = useTranslation("calculator");
  const queryClient = useQueryClient();
  const save = useSaveDishMutation(patientId);
  const [title, setTitle] = useState("");

  if (patientId === null) {
    return <p className="text-muted">{t("save.noPatient")}</p>;
  }

  if (save.isSuccess) {
    return (
      <p role="status" className="text-success">
        {t("save.saved")}
      </p>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          { title: title.trim(), rows },
          {
            onSuccess: () =>
              void queryClient.invalidateQueries({
                queryKey: ["patient", patientId, "custom-dishes"],
              }),
          },
        );
      }}
    >
      <div className="flex-1">
        <label
          className="mb-1.5 block text-sm font-medium"
          htmlFor="dish-title"
        >
          {t("save.title")}
        </label>
        <input
          id="dish-title"
          required
          value={title}
          placeholder={t("save.placeholder")}
          onChange={(event) => setTitle(event.target.value)}
          className={FIELD_CONTROL}
        />
      </div>

      <button
        type="submit"
        disabled={save.isPending || title.trim() === "" || rows.length === 0}
        className="min-h-touch rounded-lg bg-accent px-4 font-semibold text-on-accent disabled:opacity-60"
      >
        {save.isPending ? t("save.saving") : t("save.action")}
      </button>

      {save.isError && (
        <div className="w-full">
          <FormError>
            {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
          </FormError>
        </div>
      )}
    </form>
  );
}
