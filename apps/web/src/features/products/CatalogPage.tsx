import { SegmentedControl } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import {
  useAddressPatch,
  useAddressState,
  useSectionTab,
} from "../../routes/useSectionTab";
import { ProductsPanel } from "../admin/ProductsPanel";
import { DEFAULT_FOOD_STANDARD_ID } from "../standards/useFoodStandards";
import { StandardsPanel } from "../standards/StandardsPanel";
import { ProductCategoriesPanel } from "./ProductCategoriesPanel";

type CatalogView = "catalog" | "categories" | "standards";

export function CatalogPage() {
  const { t } = useTranslation("products");
  const address = useAddressState();
  const patchAddress = useAddressPatch();
  // Вид живёт в адресе (П30): на «Стандарты питания» ведёт ссылка из базы блюд.
  const [view, setView] = useSectionTab<CatalogView>(
    "tab",
    ["catalog", "categories", "standards"],
    "catalog",
  );
  const isEditingItem = address.item !== undefined && address.item !== "";

  return (
    <PageLayout
      title={t("catalog.title")}
      intro={t("catalog.intro")}
      width="wide"
      density="compact"
    >
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
            ]}
          />
        </div>
      )}

      {(isEditingItem || view === "catalog") && (
        <ProductsPanel canImport={false} chrome="screen" />
      )}

      {!isEditingItem && view === "categories" && <ProductCategoriesPanel />}

      {!isEditingItem && view === "standards" && (
        <StandardsPanel
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
    </PageLayout>
  );
}
