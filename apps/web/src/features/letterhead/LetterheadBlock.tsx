import { cn } from "@ketocare/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Поля бланка, которые печатаются; пустое — не печатается вовсе. */
export interface LetterheadFields {
  name_uz?: string | null;
  name_ru?: string | null;
  short_name?: string | null;
  department?: string | null;
  address?: string | null;
  contact?: string | null;
  license?: string | null;
  stir?: string | null;
}

function joined(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function LogoBox({
  url,
  name,
  size,
}: {
  url: string | undefined;
  name: string;
  size: "full" | "running";
}) {
  const { t } = useTranslation();
  const box = size === "full" ? "h-14 max-w-56" : "h-5 max-w-20";
  if (url === undefined) return null;
  return (
    <img
      src={url}
      alt={t("letterhead.logoAlt", { name })}
      className={cn("w-auto shrink-0 object-contain", box)}
    />
  );
}

/**
 * Бланк первой страницы (ADR-0092): логотип, название на узбекском и русском,
 * отделение, адрес и контакты; лицензия и СТИР — справа, если заданы.
 * Пока бланк не задан, документ подписан названием продукта.
 */
export function LetterheadFull({
  fields,
  logoUrl,
  fallbackName,
}: {
  fields: LetterheadFields | null;
  logoUrl?: string;
  fallbackName: string;
}) {
  const { t } = useTranslation();
  const name = fields?.name_uz ?? fallbackName;
  const second = joined([fields?.name_ru, fields?.department]);
  const contacts = joined([fields?.address, fields?.contact]);
  const details = [
    fields?.license ? t("letterhead.license", { value: fields.license }) : null,
    fields?.stir ? t("letterhead.stir", { value: fields.stir }) : null,
  ].filter((line): line is string => line !== null);

  // Блок — контейнер: на листе A4 реквизиты стоят справа от названия, а в
  // узкой колонке предпросмотра уходят под него, не сминая название.
  return (
    <div className="@container border-b-2 border-foreground pb-3 text-foreground">
      <div className="flex flex-col gap-2 @lg:flex-row @lg:items-center @lg:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <LogoBox url={logoUrl} name={name} size="full" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p
              className="text-sm font-bold"
              lang={fields?.name_uz ? "uz" : undefined}
            >
              {name}
            </p>
            {second && <p className="text-sm font-semibold">{second}</p>}
            {contacts && (
              <p className="text-xs text-muted-foreground">{contacts}</p>
            )}
          </div>
        </div>
        {details.length > 0 && (
          <div className="text-xs text-muted-foreground @lg:shrink-0 @lg:text-right">
            {details.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Колонтитул со второй страницы: знак, короткое название, документ — и справа своё. */
export function LetterheadRunning({
  shortName,
  logoUrl,
  title,
  aside,
}: {
  shortName: string;
  logoUrl?: string;
  title: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border pb-2 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <LogoBox url={logoUrl} name={shortName} size="running" />
        <b className="whitespace-nowrap text-foreground">{shortName}</b>
        <span aria-hidden>·</span>
        <span>{title}</span>
      </span>
      {aside && <span>{aside}</span>}
    </div>
  );
}
