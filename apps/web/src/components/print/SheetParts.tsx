import { formatMass } from "@ketocare/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cookingSteps } from "./steps";

/**
 * Части листа на печать (ADR-0092) — одни на все листы, чтобы назначение, день
 * меню и карточка блюда читались одним документом, а не тремя. Размеры — в
 * пунктах и миллиметрах: лист меряется бумагой, а не экраном.
 */

/** Заголовок листа: строка-надпись над ним и пояснение под ним. */
export function SheetHeading({
  kicker,
  title,
  lead,
}: {
  kicker?: string;
  title: string;
  lead?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[1.5mm]">
      {kicker !== undefined && (
        <p className="m-0 text-[10.5pt] font-bold tracking-wide text-[#2c5fe0] uppercase">
          {kicker}
        </p>
      )}
      <h1 className="m-0 text-[20pt] leading-tight font-bold">{title}</h1>
      {lead !== undefined && <p className="m-0 text-[#3d4556]">{lead}</p>}
    </div>
  );
}

export interface SheetMetric {
  key: string;
  label: string;
  value: string;
  /** Под числом — с чем его сравнить: «из 1 300», «назначено 4 : 1». */
  note?: string;
}

/** Полоса чисел в рамке: «сколько» листа одной строкой. */
export function SheetMetrics({
  metrics,
  columns = metrics.length,
}: {
  metrics: readonly SheetMetric[];
  columns?: number;
}) {
  return (
    <dl
      className="m-0 grid overflow-hidden rounded-[1.5mm] border border-[#8a93a3]"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {metrics.map((metric, index) => (
        <div
          key={metric.key}
          className="flex flex-col gap-[0.5mm] border-[#c9ced8] px-[4mm] py-[2.5mm]"
          style={{
            borderLeftWidth: index % columns === 0 ? 0 : 1,
            borderTopWidth: index >= columns ? 1 : 0,
          }}
        >
          <dt className="text-[9.5pt] text-[#4a5263]">{metric.label}</dt>
          <dd className="m-0 text-[16pt] leading-tight font-bold">
            {metric.value}
          </dd>
          {metric.note !== undefined && (
            <dd className="m-0 text-[9.5pt] text-[#4a5263]">{metric.note}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

const NOTICE_TONES = {
  warning: {
    box: "border-2 border-[#8a5300] bg-[#fef6e6]",
    stroke: "#8a5300",
    title: "text-[#8a5300]",
  },
  info: {
    box: "border border-[#8a93a3] bg-[#f2f4f8]",
    stroke: "#1a1f2e",
    title: "",
  },
} as const;

/** Плашка: «исключено», «важно» — предупреждение; «как взвешивать» — сведения. */
export function SheetNotice({
  tone,
  title,
  children,
}: {
  tone: keyof typeof NOTICE_TONES;
  title: string;
  children: ReactNode;
}) {
  const style = NOTICE_TONES[tone];
  return (
    <div
      className={`flex break-inside-avoid items-start gap-[3mm] rounded-[1.5mm] px-[4mm] py-[3mm] ${style.box}`}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={style.stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-[0.5mm] shrink-0"
      >
        {tone === "warning" ? (
          <>
            <path d="M12 3 2 21h20L12 3z" />
            <path d="M12 10v5" />
            <path d="M12 18h.01" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6" />
            <path d="M12 7.5h.01" />
          </>
        )}
      </svg>
      <p className="m-0">
        <b className={style.title}>{title}</b> {children}
      </p>
    </div>
  );
}

/** Подзаголовок раздела листа. */
export function SheetSubheading({ children }: { children: ReactNode }) {
  return <h2 className="m-0 text-[14pt] font-bold">{children}</h2>;
}

export interface WeighLine {
  key: string;
  name: string;
  grams: number;
}

/**
 * Что взвесить: квадрат «взвешено», продукт и граммы крупно. Приправы — строкой
 * под таблицей, без граммов: в расчёт они не входят (ADR-0054).
 */
export function WeighTable({
  lines,
  seasonings = [],
}: {
  lines: readonly WeighLine[];
  seasonings?: readonly string[];
}) {
  const { t } = useTranslation("common");
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b-2 border-[#1a1f2e] text-left text-[9.5pt] text-[#4a5263]">
          <th
            scope="col"
            className="w-[22mm] py-[1.5mm] pr-[3mm] font-semibold"
          >
            {t("print.weighed")}
          </th>
          <th scope="col" className="py-[1.5mm] pr-[3mm] font-semibold">
            {t("print.product")}
          </th>
          <th scope="col" className="py-[1.5mm] text-right font-semibold">
            {t("print.weight")}
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr
            key={line.key}
            className="break-inside-avoid border-b border-[#c9ced8]"
          >
            <td className="py-[2mm]">
              <span
                aria-hidden="true"
                className="block size-[5mm] rounded-[0.5mm] border-[1.5px] border-[#1a1f2e]"
              />
            </td>
            <td className="py-[2mm] pr-[3mm] text-[13pt]">{line.name}</td>
            <td className="py-[2mm] text-right text-[15pt] font-bold whitespace-nowrap tabular-nums">
              {t("print.grams", { value: formatMass(line.grams) })}
            </td>
          </tr>
        ))}
        {seasonings.length > 0 && (
          <tr>
            <td />
            <td colSpan={2} className="py-[2mm] text-[#4a5263]">
              {t("print.seasonings", { names: seasonings.join(", ") })}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Шаги приготовления: строка текста — шаг; одна строка — абзац, не список. */
export function CookingSteps({ text }: { text: string | null | undefined }) {
  const { t } = useTranslation("common");
  const steps = cookingSteps(text);
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-col gap-[2mm]">
      <SheetSubheading>{t("print.steps")}</SheetSubheading>
      {steps.length === 1 ? (
        <p className="m-0 text-[12.5pt] leading-normal">{steps[0]}</p>
      ) : (
        <ol className="m-0 flex list-decimal flex-col gap-[1.5mm] pl-[6mm] text-[12.5pt] leading-normal">
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Строки для подписи от руки: «Назначил(а)», «Подпись», «Дата». */
export function SignatureLines({ labels }: { labels: readonly string[] }) {
  return (
    <div
      className="grid gap-[5mm] pt-[2mm]"
      style={{
        gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`,
      }}
    >
      {labels.map((label) => (
        <div key={label}>
          <div className="h-[8mm] border-b border-[#1a1f2e]" />
          <p className="m-0 mt-[1.5mm] text-[9.5pt] text-[#4a5263]">{label}</p>
        </div>
      ))}
    </div>
  );
}
