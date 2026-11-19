import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { DocumentFrame } from "../../features/letterhead/useDocumentFrame";
import "./print.css";

export interface PrintedSheetSpec {
  key: string;
  /** Что за лист — в колонтитуле: «Назначение», «Меню на 20 ноября». */
  title: string;
  /** Справа в колонтитуле: ребёнок, приём. */
  aside?: string;
  /** Шифр шаблона: «KC-RX-1», «KC-WEEK-1», «KC-DISH-1». */
  code: string;
  content: ReactNode;
}

/**
 * Листы кабинета на печать в едином стандарте (ADR-0092).
 *
 * Каждый лист — своя страница со своей шапкой (знак и короткое название
 * клиники, лист, ребёнок) и подвалом («Стр. X из Y», кто и когда, телефон для
 * семей). Поля страницы — ноль (`print.css`): тогда браузер не печатает в них
 * адрес страницы с идентификатором пациента и дату, а отступы листа даёт сам
 * лист. Лист длиннее страницы переходит на следующую с теми же отступами
 * (`box-decoration-break: clone`).
 */
export function PrintedSheets({
  frame,
  sheets,
  audience = "family",
}: {
  frame: DocumentFrame;
  sheets: readonly PrintedSheetSpec[];
  /** Лист семьи несёт телефон клиники для вопросов по диете. */
  audience?: "family" | "staff";
}) {
  const { t } = useTranslation("common");
  const total = sheets.length;

  return (
    <>
      {sheets.map((sheet, index) => (
        <section key={sheet.key} className="print-sheet">
          <header className="flex items-center justify-between gap-4 border-b border-[#8a93a3] pb-1.5 text-[9pt] text-[#4a5263]">
            <span className="flex min-w-0 items-center gap-1.5">
              {frame.logoUrl !== undefined && (
                <img src={frame.logoUrl} alt="" className="h-[5mm] w-auto" />
              )}
              <b className="whitespace-nowrap text-[#1a1f2e]">
                {frame.shortName}
              </b>
              <span aria-hidden="true">·</span>
              <span>{sheet.title}</span>
            </span>
            {sheet.aside !== undefined && sheet.aside !== "" && (
              <span className="text-right">{sheet.aside}</span>
            )}
          </header>

          <div className="print-sheet-body">{sheet.content}</div>

          <footer className="flex items-start justify-between gap-4 border-t border-[#8a93a3] pt-1.5 text-[8pt] text-[#4a5263]">
            <span>
              {[
                audience === "family" && frame.familyPhone
                  ? t("printFrame.familyPhone", { phone: frame.familyPhone })
                  : null,
                frame.author
                  ? t("printFrame.generatedBy", {
                      who: frame.author,
                      when: frame.generatedAt,
                    })
                  : t("printFrame.generated", { when: frame.generatedAt }),
                t("printFrame.code", { code: sheet.code }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="whitespace-nowrap">
              {t("printFrame.page", { page: index + 1, total })}
            </span>
          </footer>
        </section>
      ))}
    </>
  );
}
