import { Button, toast } from "@ketocare/ui";
import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { downloadBlob } from "../lib/wordExport";

/**
 * «Скачать Excel» для списков (ADR-0092): файл собирает сервер тем же отбором,
 * что на экране, — с бланком клиники в колонтитулах и листом «Сведения».
 */
export function ExcelButton({
  label,
  fileName,
  download,
}: {
  label: string;
  /** Имя файла с расширением. */
  fileName: string;
  download: () => Promise<Blob>;
}) {
  const { t } = useTranslation("common");
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      downloadBlob(await download(), fileName);
    } catch {
      toast.error(t("excel.failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => void run()}
    >
      <FileSpreadsheet aria-hidden="true" />
      {pending ? t("excel.pending") : label}
    </Button>
  );
}
