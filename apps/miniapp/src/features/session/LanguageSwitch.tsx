import { Button, SegmentedControl } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import {
  LANGUAGES,
  type Language,
  applyLanguage,
  knownLanguage,
} from "../../lib/i18n";
import { haptic } from "../../lib/telegram";

/**
 * Выбор языка: русский или узбекский (ADR-0052, решение заказчика G3).
 *
 * Как у переключателей госуслуг (my.gov.uz): каждый язык подписан на самом
 * себе — «O‘zbekcha», а не «Узбекский», — а подпись группы двуязычная. Человек,
 * не читающий языка, на котором экран открылся, обязан узнать кнопку.
 * Переключатель — `SegmentedControl` кита высотой 44 px: прежние кнопки по
 * 32 px были мельче пальца.
 *
 * `persist` — сохранить выбор на сервере. Язык — свойство человека: его же
 * прочтут бот и напоминания воркера. До входа сохранять некуда, и выбор живёт
 * только на этом экране.
 *
 * **Отказ сохранения можно повторить.** Прежде экран уже стоял на новом языке,
 * и повторное нажатие на него ничего не делало — «выберите ещё раз» было
 * невыполнимо. Теперь под переключателем стоит «Повторить», и повторный выбор
 * того же языка тоже отправляет его заново.
 */
export function LanguageSwitch({ persist }: { persist: boolean }) {
  const { t, i18n } = useTranslation();
  const active = knownLanguage(i18n.language) ?? "ru";
  const [failed, setFailed] = useState<Language | null>(null);
  const [saving, setSaving] = useState(false);

  const save = (language: Language) => {
    setSaving(true);
    setFailed(null);
    void api
      .PUT("/api/v1/users/me/language", { body: { language } })
      .then((result) => {
        if (result.error !== undefined) throw result.error;
      })
      .catch(() => {
        haptic("error");
        setFailed(language);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const choose = (language: Language) => {
    if (language === active && failed !== language) return;
    applyLanguage(language);
    if (persist) save(language);
  };

  return (
    <div className="flex flex-col gap-field">
      <SegmentedControl
        label={t("language.label")}
        value={active}
        onChange={choose}
        items={LANGUAGES.map((language) => ({
          value: language,
          label: (
            <span lang={language === "uz" ? "uz-Latn" : "ru"}>
              {t(`language.${language}`)}
            </span>
          ),
        }))}
        className="w-full [&>label]:flex-1"
      />
      {failed !== null && (
        <div className="flex flex-col gap-1">
          <p role="alert" className="m-0 text-sm text-destructive">
            {t("language.saveFailed")}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-touch w-full"
            disabled={saving}
            onClick={() => save(failed)}
          >
            {t("actions.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
