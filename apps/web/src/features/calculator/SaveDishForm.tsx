import { FormFooter, Section, toast } from "@ketocare/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import type { DishRow } from "./types";
import { useSaveDishMutation } from "./useCalcMutations";

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
    return (
      <p className="m-0 text-sm text-muted-foreground">{t("save.noPatient")}</p>
    );
  }

  return (
    <Section title={t("save.action")} description={t("save.description")}>
      <form
        className="flex flex-col gap-block"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            { title: title.trim(), rows },
            {
              onSuccess: () => {
                // Успех — тост, а не зелёная строка навсегда в потоке
                // страницы (П16 канона): форма остаётся на месте и готова
                // принять следующее блюдо.
                toast.success(t("save.saved"));
                setTitle("");
                void queryClient.invalidateQueries({
                  queryKey: ["patient", patientId, "custom-dishes"],
                });
              },
            },
          );
        }}
      >
        <Field
          id="dish-title"
          label={t("save.title")}
          required
          width="wide"
          value={title}
          placeholder={t("save.placeholder")}
          onChange={(event) => setTitle(event.target.value)}
        />

        {save.isError && (
          <FormError>
            {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("save.submit")}
          pendingLabel={t("save.saving")}
          pending={save.isPending}
          disabled={title.trim() === "" || rows.length === 0}
        />
      </form>
    </Section>
  );
}
