import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@ketocare/ui";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending?: boolean;
  children: ReactNode;
}

export function SubmitButton({
  pending,
  children,
  className,
  ...props
}: Props) {
  return (
    <button
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending}
      className={cn(
        "min-h-touch w-full rounded-lg bg-accent px-4 py-2.5 font-semibold text-on-accent",
        "disabled:cursor-progress disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
