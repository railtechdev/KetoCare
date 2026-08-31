import { WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { MenuRead } from "./useMenu";

/**
 * Предупреждение: в блюдах этого дня есть продукт, выведенный из оборота.
 *
 * Вывод продукта убирает его из поиска, но не из уже сохранённых рецептов,
 * своих блюд и меню — и правильно: убрать блюдо из прошлого дня значит
 * подменить то, чем ребёнка кормили на самом деле. Плохо было другое: об этом
 * никто не узнавал. Позиция считалась в итогах дня без единой пометки, а
 * выводят продукт обычно потому, что его числа оказались неверными.
 *
 * Уровень `warning`, а не `danger`: числа дня не обязательно неверны, но
 * проверить их у диетолога стоит. Запрета нет — история должна считаться.
 */
export function WithdrawnProductsNotice({
  withdrawn,
}: {
  withdrawn: MenuRead["withdrawn_products"] | undefined;
}) {
  const { t } = useTranslation("menu");

  if (withdrawn === undefined || withdrawn.length === 0) return null;

  return (
    <WarningBanner level="warning" title={t("withdrawn.title")}>
      {t("withdrawn.body", {
        list: withdrawn.map((entry) => entry.name_ru).join(", "),
        count: withdrawn.length,
      })}
    </WarningBanner>
  );
}
