import { Button, Section } from "@ketocare/ui";
import { ArrowLeft, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SettingsSection } from "../../lib/launchTarget";
import { homeScreenShortcut } from "../../lib/telegram";
import { useTelegramBack } from "../../lib/useTelegram";
import { FamilyBlock } from "../family/FamilyBlock";
import { RemindersBlock } from "../reminders/RemindersBlock";
import { LanguageSwitch } from "../session/LanguageSwitch";
import { WebAccessPanel } from "../session/WebAccessPanel";
import type { Session } from "../session/useSession";

/**
 * Настройки — отдельным экраном (ADR-0075).
 *
 * Прежде язык, напоминания, близкие и вход в кабинет стояли на главной под
 * сводкой: 2,6 экрана, из которых ежедневного — первый. Их меняют раз в месяц,
 * а сводку смотрят каждый день. Вход — шестерёнкой в шапке и пунктом
 * «Настройки» в меню Telegram (Bot API 7.0); выход — кнопкой «Назад» Telegram
 * или своей кнопкой вне Telegram.
 */
export function SettingsScreen({
  session,
  section,
  onClose,
}: {
  session: Session;
  /** Прокрутить к разделу — открыто кнопкой бота «Напоминания», «Близкие». */
  section?: SettingsSection;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useTelegramBack(onClose);

  useEffect(() => {
    if (section === undefined) return;
    document
      .getElementById(`settings-${section}`)
      ?.scrollIntoView?.({ block: "start" });
  }, [section]);

  return (
    <main className="flex flex-col gap-section p-section">
      <Button
        variant="ghost"
        className="min-h-touch self-start"
        onClick={onClose}
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("settings.back")}
      </Button>
      <h1 className="text-page-title">{t("settings.title")}</h1>

      {/* Язык — первым: его ищет тот, кто не читает языка, на котором
          приложение открылось (ADR-0052). */}
      <Section title={t("language.label")} density="compact">
        <LanguageSwitch persist />
      </Section>
      <div id="settings-reminders" className="scroll-mt-4">
        <RemindersBlock session={session} />
      </div>
      <div id="settings-family" className="scroll-mt-4">
        <FamilyBlock session={session} />
      </div>
      <WebAccessPanel session={session} />
      <HomeScreenOffer />
    </main>
  );
}

/**
 * «Добавить на главный экран» (Bot API 8.0) — только где клиент умеет и ярлыка
 * ещё нет: приложение открывается с телефона, не разыскивая чат с ботом.
 */
function HomeScreenOffer() {
  const { t } = useTranslation();
  const [offer, setOffer] = useState(false);
  const [add, setAdd] = useState<(() => void) | null>(null);
  useEffect(() => {
    const open = homeScreenShortcut(setOffer);
    setAdd(() => open);
  }, []);

  if (!offer || add === null) return null;
  return (
    <Section title={t("settings.homeScreen.title")} density="compact">
      <Button
        type="button"
        variant="outline"
        className="min-h-touch w-full"
        onClick={() => {
          add();
          setOffer(false);
        }}
      >
        <Smartphone aria-hidden="true" className="size-4" />
        {t("settings.homeScreen.action")}
      </Button>
    </Section>
  );
}
