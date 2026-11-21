import { telHref } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

/**
 * «Телефон клиники: +998 …» — ссылкой для звонка; без номера — ничего.
 *
 * Ссылка — блок высотой в касание: строчная ссылка была высотой в строку
 * (около 20 px), и `min-height` базовой темы на строчный элемент не действует.
 * А это главный следующий шаг под отказом (П4).
 *
 * Один на помощника, «Сегодня» и настройки (Р4 аудита Mini App): номер, который
 * семья видит в трёх местах, записан одинаково и звонит одинаково.
 */
export function ClinicPhone({ phone }: { phone: string | null }) {
  const { t } = useTranslation();
  const href = telHref(phone);
  if (phone === null || href === null) return null;
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1">
      {t("clinic.phone")}
      <a
        href={href}
        className="inline-flex min-h-touch items-center font-medium whitespace-nowrap text-primary underline underline-offset-2"
      >
        {phone}
      </a>
    </p>
  );
}
