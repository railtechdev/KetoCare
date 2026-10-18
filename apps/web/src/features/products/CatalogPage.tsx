import { SegmentedControl } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { useAddressState } from "../../routes/useSectionTab";
import { ProductsPanel } from "../admin/ProductsPanel";
import { ProductCategoriesPanel } from "./ProductCategoriesPanel";

type CatalogView = "catalog" | "categories";

export function CatalogPage() {
  const { t } = useTranslation("products");
  const address = useAddressState();
  const [view, setView] = useState<CatalogView>("catalog");
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
            ]}
          />
        </div>
      )}

      {(isEditingItem || view === "catalog") && (
        <ProductsPanel canImport={false} chrome="screen" />
      )}

      {!isEditingItem && view === "categories" && <ProductCategoriesPanel />}
    </PageLayout>
  );
}
