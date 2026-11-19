import { Button } from "@ketocare/ui";
import { Printer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Печать листа: содержимое уходит в отдельный узел `body`, а приложение на
 * время печати скрывается. Содержимое должно быть готово к нажатию: печать
 * запускается сразу, ждать загрузки ей негде.
 */
export function PrintButton({
  label,
  disabled = false,
  describedBy,
  children,
}: {
  label: string;
  disabled?: boolean;
  /** Строка с причиной недоступности (`ActionReason`, правило П44). */
  describedBy?: string;
  children: ReactNode;
}) {
  const [run, setRun] = useState(0);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (run === 0) return;
    const root = document.getElementById("root");
    root?.classList.add("print:hidden");
    const done = () => {
      root?.classList.remove("print:hidden");
      setPrinting(false);
    };
    window.addEventListener("afterprint", done);
    // Листы набраны Noto Sans (ADR-0092): печать ждёт шрифт, иначе первый лист
    // уходил бы запасным. Без поддержки `document.fonts` — печать сразу.
    let cancelled = false;
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    const ready =
      fonts === undefined
        ? Promise.resolve()
        : Promise.all([
            fonts.load('400 11pt "Noto Sans"'),
            fonts.load('700 11pt "Noto Sans"'),
          ]).catch(() => undefined);
    void ready.then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", done);
      root?.classList.remove("print:hidden");
    };
  }, [run]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={() => {
          setPrinting(true);
          setRun((current) => current + 1);
        }}
      >
        <Printer aria-hidden="true" />
        {label}
      </Button>
      {printing &&
        createPortal(
          <div className="hidden bg-white text-black print:block">
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
