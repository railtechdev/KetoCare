import { WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { Menu } from "./useMenu";

type FlaggedProduct = Menu["excluded_products"][number];

/**
 * Продукты дня, о которых семье надо знать до того, как взвешивать: исключённые
 * ребёнку и убранные из списка продуктов. Одни на меню дня и на «Сегодня».
 *
 * На «Сегодня» их прежде не было вовсе (аудит 26.11.2026, 1.1): граммы
 * ближайшего приёма раскрыты там сразу, и предупреждение об исключённом
 * продукте стояло не на том экране, с которого готовят. Каждая строка называет
 * блюдо и приём — сервер отдаёт позиции (`item_ids`), искать продукт по
 * раскрытым составам родителю незачем.
 *
 * Запрета здесь нет: исключения уточняются по ходу терапии, и вчерашний план
 * мог быть согласован с врачом (вопрос 29). Что именно делать с блюдом, решает
 * врач — текст отправляет к нему, а не советует сам.
 */
export function MenuProductWarnings({ menu }: { menu: Menu }) {
  const { t } = useTranslation();

  const lines = (products: readonly FlaggedProduct[]) =>
    products.map((product) => {
      const dishes = menu.items
        .filter((item) => product.item_ids.includes(item.id))
        .map((item) =>
          t("menu.flagged.dish", {
            title: item.title ?? t("menu.unknownDish"),
            index: item.meal_index,
          }),
        );
      return (
        <li key={product.product_id}>
          {dishes.length > 0
            ? t("menu.flagged.line", {
                product: product.name_ru,
                dishes: dishes.join(", "),
              })
            : product.name_ru}
        </li>
      );
    });

  return (
    <>
      {menu.excluded_products.length > 0 && (
        // Молчать нельзя: по этому меню кормят сегодня.
        <WarningBanner level="danger" title={t("menu.excluded")}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {lines(menu.excluded_products)}
          </ul>
          <p className="m-0 mt-1">{t("menu.excludedHint")}</p>
        </WarningBanner>
      )}
      {menu.withdrawn_products.length > 0 && (
        <WarningBanner level="warning" title={t("menu.withdrawn")}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {lines(menu.withdrawn_products)}
          </ul>
          <p className="m-0 mt-1">{t("menu.withdrawnHint")}</p>
        </WarningBanner>
      )}
    </>
  );
}
