import { Button, FormSheet, toast } from "@ketocare/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DiaryForm } from "../diary/DiaryForm";
import type { DiaryBody } from "../diary/diaryApi";
import { useDiaryMutations } from "../diary/useDiary";
import { growthKey } from "./therapyCourse";

/** Запись веса специалистом: на приёме ребёнка взвешивают при враче. */
export function RecordWeight({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const queryClient = useQueryClient();
  const { create } = useDiaryMutations(patientId, "weight");
  const [open, setOpen] = useState(false);

  function submit(body: DiaryBody, onSaved: () => void) {
    create.mutate(body, {
      onSuccess: () => {
        onSaved();
        setOpen(false);
        toast.success(t("growth.recorded"));
        void queryClient.invalidateQueries({ queryKey: growthKey(patientId) });
      },
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {t("growth.record")}
      </Button>
      <FormSheet
        closeLabel={t("common:actions.close")}
        open={open}
        onOpenChange={setOpen}
        title={t("growth.record")}
      >
        {open && (
          <DiaryForm
            kind="weight"
            editing={null}
            seizureTypes={[]}
            durationOptions={[]}
            medications={[]}
            onSubmit={submit}
            onCancel={() => setOpen(false)}
            pending={create.isPending}
            error={create.error}
          />
        )}
      </FormSheet>
    </>
  );
}
