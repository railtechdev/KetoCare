import { Button, toast } from "@ketocare/ui";
import { FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  buildWordDocument,
  downloadBlob,
  wordFileName,
  type WordDocumentModel,
} from "../lib/wordExport";

/**
 * «Скачать Word» рядом с «Печатью»: тот же лист, но в файле, который можно
 * поправить перед отправкой семье или повару (ADR-0088, дополнение
 * 17.11.2026).
 *
 * Модель собирается в момент нажатия: к нему данные уже на экране, и файл
 * совпадает с тем, что человек видит.
 */
export function WordButton({
  label,
  fileName,
  build,
  disabled = false,
  describedBy,
}: {
  label: string;
  /** Имя файла без расширения: блюдо, ребёнок и неделя. */
  fileName: string;
  build: () => WordDocumentModel;
  disabled?: boolean;
  /** Строка с причиной недоступности (`ActionReason`, правило П44). */
  describedBy?: string;
}) {
  const { t } = useTranslation("common");
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      const blob = await buildWordDocument(build());
      downloadBlob(blob, wordFileName(fileName));
    } catch {
      toast.error(t("word.failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-describedby={describedBy}
      onClick={() => void run()}
    >
      <FileText aria-hidden="true" />
      {pending ? t("word.pending") : label}
    </Button>
  );
}
