import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button, toast } from "@ketocare/ui";

import { api } from "../../lib/api";
import {
  LANGUAGES,
  type Language,
  applyLanguage,
  knownLanguage,
} from "../../lib/i18n";

/**
 * Выбор языка: русский или узбекский (ADR-0052, решение заказчика G3).
 *
 * Как у переключателей госуслуг (my.gov.uz): каждый язык подписан на самом
 * себе — «O‘zbekcha», а не «Узбекский», — а подпись группы двуязычная. Человек,
 * не читающий языка, на котором экран открылся, обязан узнать кнопку.
 *
 * Стоит на главной и на экранах, где приложение не открылось: тупик на
 * незнакомом языке — худший из тупиков.
 *
 * `persist` — сохранить выбор на сервере. Язык — свойство человека: его же
 * прочтут бот и напоминания воркера. До входа сохранять некуда, и выбор живёт
 * только на этом экране.
 */
export function LanguageSwitch({ persist }: { persist: boolean }) {
  const { t, i18n } = useTranslation();
  const active = knownLanguage(i18n.language) ?? "ru";

  const choose = (language: Language) => {
    if (language === active) return;
    applyLanguage(language);
    if (!persist) return;
    void api
      .PUT("/api/v1/users/me/language", { body: { language } })
      .then((result) => {
        if (result.error !== undefined) toast.error(t("language.saveFailed"));
      })
      .catch(() => {
        toast.error(t("language.saveFailed"));
      });
  };

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/60 p-1"
    >
      <Globe
        aria-hidden="true"
        className="ml-1.5 size-3.5 text-muted-foreground"
      />
      {LANGUAGES.map((language) => (
        <Button
          key={language}
          type="button"
          size="xs"
          variant="ghost"
          aria-pressed={language === active}
          lang={language === "uz" ? "uz-Latn" : "ru"}
          className={
            language === active
              ? "min-h-8 bg-card px-2.5 font-medium text-foreground shadow-xs hover:bg-card"
              : "min-h-8 px-2.5 text-muted-foreground hover:text-foreground"
          }
          onClick={() => {
            choose(language);
          }}
        >
          {t(`language.${language}`)}
        </Button>
      ))}
    </div>
  );
}
