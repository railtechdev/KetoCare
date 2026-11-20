import { useEffect } from "react";

import { useLetterhead, useLetterheadLogoUrl } from "./useLetterhead";

/** Знак кабинета: клиника из бланка, пока бланк не задан, — продукт. */
export interface ClinicBrand {
  /** `undefined` — бланк ещё едет: подпись не мигает «KetoCare» перед клиникой. */
  name: string | undefined;
  logoUrl: string | undefined;
  /** Бланк прочитан и логотипа в нём нет — на месте знака стоит значок продукта. */
  noLogo: boolean;
}

/**
 * Название и логотип клиники в каркасе кабинета (ADR-0092). Тот же бланк, что
 * на документах: администратор задаёт его один раз, и клиника видит себя и на
 * экране, и на бумаге. Заголовок вкладки браузера — то же название.
 */
export function useClinicBrand(): ClinicBrand {
  const letterhead = useLetterhead();
  const sha256 = letterhead.data?.logo?.sha256;
  const logoUrl = useLetterheadLogoUrl(sha256);
  const name = letterhead.data
    ? (letterhead.data.text?.short_name ?? letterhead.data.fallback_name)
    : undefined;

  useEffect(() => {
    if (name !== undefined) document.title = name;
  }, [name]);

  return {
    name,
    logoUrl,
    noLogo: letterhead.data !== undefined && sha256 === undefined,
  };
}
