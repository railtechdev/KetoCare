import { formatOccurredAt } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { useMe } from "../auth/useMe";
import { useLetterhead, useLetterheadLogo } from "./useLetterhead";

/**
 * Рамка документа кабинета (ADR-0092): то, что стоит в шапке и подвале каждого
 * листа на печать и в Word, — бланк клиники, кто и когда сформировал.
 *
 * Время берётся в момент отрисовки: лист печатают сразу после нажатия.
 */
export interface DocumentFrame {
  shortName: string;
  logoUrl: string | undefined;
  /** Файл логотипа для Word; `undefined` — логотипа нет или он ещё едет. */
  logoBlob: Blob | undefined;
  /** Телефон для семей — в подвале листов семьи. */
  familyPhone: string | null;
  /** «Иванова Анна Петровна, диетолог»; `null` — профиль ещё не загружен. */
  author: string | null;
  generatedAt: string;
}

export function useDocumentFrame(): DocumentFrame {
  const { t } = useTranslation("common");
  const letterhead = useLetterhead();
  const me = useMe();
  const logo = useLetterheadLogo(letterhead.data?.logo?.sha256);
  const text = letterhead.data?.text ?? null;
  const role = me.data?.role;

  return {
    shortName: text?.short_name ?? letterhead.data?.fallback_name ?? "KetoCare",
    logoUrl: logo.url,
    logoBlob: logo.blob,
    familyPhone: text?.family_phone ?? null,
    author:
      me.data === undefined
        ? null
        : [me.data.full_name, role ? t(`printFrame.roles.${role}`) : null]
            .filter(Boolean)
            .join(", "),
    generatedAt: formatOccurredAt(new Date()),
  };
}
