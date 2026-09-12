import type { ProductName } from "@ketocare/ui";

/**
 * Состояние имени продукта — словами.
 *
 * Разбор состояний общий с Mini App (`productNameState` в ките), а тексты свои:
 * это i18n, а не логика. Один переводчик на карточку и на форму — чтобы они не
 * разошлись в том, как называют одно и то же событие.
 */
export function productLabel(
  state: ProductName,
  t: (key: string) => string,
): string {
  switch (state.kind) {
    case "name":
      return state.name;
    case "missing":
      return t("detail.unknownProduct");
    case "unavailable":
      return t("detail.nameUnavailable");
    case "pending":
      return t("detail.loadingName");
  }
}
