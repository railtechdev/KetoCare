import { SegmentedControl } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import {
  useAddressPatch,
  useAddressState,
  useSectionTab,
} from "../../routes/useSectionTab";
import { ProductAnomaliesPanel } from "../admin/ProductAnomaliesPanel";
import { ProductsPanel } from "../admin/ProductsPanel";
import { DEFAULT_FOOD_STANDARD_ID } from "../standards/useFoodStandards";
import { StandardsSection } from "../standards/StandardsSection";
import { ProductCategoriesPanel } from "./ProductCategoriesPanel";

const CATALOG_VIEWS = [
  "catalog",
  "categories",
  "standards",
  "anomalies",
] as const;

type CatalogView = (typeof CATALOG_VIEWS)[number];

/**
 * Справочник продуктов тех, кто его ведёт: диетолога, врача и администратора.
 *
 * Один экран на три роли. У администратора он прежде был своим — с теми же
 * видами, но вид держался в состоянии вкладки, и F5 возвращал к перечню, —
 * а проверка подозрительных значений жила только там, хотя раздела продуктов
 * в меню администратора нет. Её не видел никто из тех, кто правит значения
 * (ADR-0073). Право на каждый вид проверяет сервер.
 */
export function CatalogPage() {
  const { t } = useTranslation(["products", "admin"]);
  const address = useAddressState();
  const patchAddress = useAddressPatch();
  // Вид живёт в адресе (П30): на «Источники» ведёт ссылка из базы блюд, на
  // проверку — ссылка с главной администратора.
  const [chosen, setView] = useSectionTab<CatalogView>(
    "tab",
    CATALOG_VIEWS,
    "catalog",
  );
  // Сборка рабочего справочника — внутри «Источников» (`?kind=merge`,
  // ADR-0068): открытая по ссылке без `?tab=`, она не должна упасть в перечень.
  const view: CatalogView = address.kind === "merge" ? "standards" : chosen;
  const isEditingItem = address.item !== undefined && address.item !== "";

  return (
    <PageLayout title={t("catalog.title")} width="wide" density="compact">
      {!isEditingItem && (
        <div>
          <SegmentedControl<CatalogView>
            label={t("catalog.title")}
            value={view}
            onChange={setView}
            items={[
              { value: "catalog", label: t("catalog.title") },
              { value: "categories", label: t("categories.title") },
              { value: "standards", label: t("standards.title") },
              {
                value: "anomalies",
                label: t("admin:products.anomalies.title"),
              },
            ]}
          />
        </div>
      )}

      {(isEditingItem || view === "catalog") && (
        <ProductsPanel chrome="screen" />
      )}

      {!isEditingItem && view === "categories" && <ProductCategoriesPanel />}

      {!isEditingItem && view === "standards" && (
        <StandardsSection
          onOpen={(standardId) => {
            patchAddress({
              standard:
                standardId === DEFAULT_FOOD_STANDARD_ID
                  ? undefined
                  : standardId,
            });
            setView("catalog");
          }}
        />
      )}

      {!isEditingItem && view === "anomalies" && <ProductAnomaliesPanel />}
    </PageLayout>
  );
}
