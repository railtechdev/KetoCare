import { formatOccurredAt } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { QrCode } from "../../components/QrCode";
import type { AccessCodeCreated } from "./useAccessCodes";

/** Имя бота из ссылки `https://t.me/<бот>?start=<код>`; иначе `null`. */
export function botName(deepLink: string | null | undefined): string | null {
  if (deepLink === null || deepLink === undefined) return null;
  const match = /^https:\/\/t\.me\/([A-Za-z0-9_]{3,64})(?:\?|$)/.exec(deepLink);
  return match ? `@${match[1]}` : null;
}

/** «K7Q4M2PX» → «K7Q4 M2PX»: восемь знаков читаются двумя группами. */
export function groupedCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/**
 * Лист «Доступ для семьи» (ADR-0092, этап 6 плана документов): родитель
 * забирает код с приёма на бумаге, а не переписывает с экрана врача.
 *
 * Крупный QR и код, три шага, предупреждение «не показывайте посторонним» —
 * словом и значком, не цветом, — и те же шаги по-узбекски. Узбекский текст до
 * запуска вычитывает носитель языка, как и остальные тексты семьи (ADR-0052).
 */
export function AccessCodeSheet({ issued }: { issued: AccessCodeCreated }) {
  const { t } = useTranslation("access");
  const bot = botName(issued.deep_link);
  const expires = formatOccurredAt(new Date(issued.expires_at));

  return (
    <div className="flex flex-col gap-[6mm] text-[13pt] leading-snug">
      <div className="flex flex-col gap-[2mm]">
        <h1 className="m-0 text-[22pt] leading-tight font-bold">
          {t("sheet.title")}
        </h1>
        <p className="m-0 text-[#3d4556]">
          {bot === null ? t("sheet.leadWeb") : t("sheet.leadTelegram")}
        </p>
      </div>

      <div className="flex items-center gap-[8mm]">
        <QrCode
          value={issued.deep_link ?? issued.join_url}
          alt={t("panel.qrAlt", { code: issued.code })}
          className="shrink-0 [&_svg]:size-[55mm]"
        />
        <div className="flex flex-col gap-[2mm]">
          <p className="m-0 text-[#4a5263]">{t("sheet.orType")}</p>
          <p className="m-0 font-mono text-[28pt] font-semibold tracking-widest">
            {groupedCode(issued.code)}
          </p>
          <p className="m-0 text-[11pt] text-[#4a5263]">
            {t("sheet.codeRules", { date: expires })}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-[2mm]">
        <h2 className="m-0 text-[15pt] font-bold">{t("sheet.stepsTitle")}</h2>
        <ol className="m-0 flex list-decimal flex-col gap-[1.5mm] pl-[7mm]">
          {bot !== null ? (
            <>
              <li>{t("sheet.steps.telegram1", { bot })}</li>
              <li>{t("sheet.steps.telegram2")}</li>
              <li>{t("sheet.steps.telegram3")}</li>
            </>
          ) : (
            <>
              <li>{t("sheet.steps.web1")}</li>
              <li>{t("sheet.steps.web2")}</li>
            </>
          )}
        </ol>
        <p className="m-0 text-[11pt] break-all text-[#4a5263]">
          {t("sheet.webLink", { url: issued.join_url })}
        </p>
      </div>

      <div className="flex gap-[3mm] rounded-[1.5mm] border-2 border-[#8a5300] bg-[#fef6e6] px-[4mm] py-[3mm]">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#8a5300"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mt-[0.5mm] shrink-0"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <p className="m-0">
          <b className="text-[#8a5300]">{t("sheet.warningTitle")}</b>{" "}
          {t("sheet.warning", { date: expires })}
        </p>
      </div>

      <div
        lang="uz"
        className="flex flex-col gap-[2mm] border-t border-[#c9ced8] pt-[4mm] text-[12pt]"
      >
        <h2 className="m-0 text-[14pt] font-bold">{t("sheet.uz.title")}</h2>
        <ol className="m-0 flex list-decimal flex-col gap-[1mm] pl-[7mm]">
          {bot !== null ? (
            <>
              <li>{t("sheet.uz.telegram1", { bot })}</li>
              <li>{t("sheet.uz.telegram2")}</li>
            </>
          ) : (
            <li>{t("sheet.uz.web1")}</li>
          )}
          <li>{t("sheet.uz.warning", { date: expires })}</li>
        </ol>
      </div>
    </div>
  );
}
