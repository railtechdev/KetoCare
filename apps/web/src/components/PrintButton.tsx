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
  children,
}: {
  label: string;
  disabled?: boolean;
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
    window.print();
    return () => {
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
          <div className="hidden bg-white p-4 text-black print:block">
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
