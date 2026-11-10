import {
  AsyncSection,
  Button,
  FormSheet,
  RatioBadge,
  WarningBanner,
  formatKcal,
} from "@ketocare/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api, errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import type { FoodStandard } from "./useFoodStandards";

function useTemplates(standardId: string) {
  return useQuery({
    queryKey: ["products", "standards", standardId, "menu-templates"],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/food-standards/{standard_id}/menu-templates",
        { params: { path: { standard_id: standardId } } },
      );
      if (error || !data) throw error ?? new Error("Empty templates response");
      return data;
    },
  });
}

function useTemplate(templateId: string | null) {
  return useQuery({
    queryKey: ["products", "standards", "menu-template", templateId],
    enabled: templateId !== null,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/food-standards/menu-templates/{template_id}",
        { params: { path: { template_id: templateId as string } } },
      );
      if (error || !data) throw error ?? new Error("Empty template response");
      return data;
    },
  });
}

/** Шаблоны меню стандарта: только просмотр, применение к ребёнку — отдельный этап. */
export function MenuTemplatesSheet({
  standard,
  onClose,
}: {
  standard: FoodStandard;
  onClose: () => void;
}) {
  const { t } = useTranslation("products");
  const templates = useTemplates(standard.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useTemplate(openId);
  const days = new Map<number, NonNullable<typeof detail.data>["items"]>();
  for (const item of detail.data?.items ?? []) {
    days.set(item.cycle_day, [...(days.get(item.cycle_day) ?? []), item]);
  }

  return (
    <FormSheet
      closeLabel={t("common:actions.close")}
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t("standards.templates.title", { name: standard.name })}
    >
      <div className="flex flex-col gap-section">
        {standard.diet_type === "general" && (
          <WarningBanner
            level="warning"
            title={t("standards.templates.generalTitle")}
          >
            {t("standards.templates.generalBody")}
          </WarningBanner>
        )}

        <AsyncSection
          {...queryState(templates)}
          skeleton={null}
          error={
            templates.isError
              ? {
                  title: t("standards.templates.error"),
                  description:
                    errorMessageOf(templates.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void templates.refetch()}
          isEmpty={(templates.data ?? []).length === 0}
          empty={<p className="m-0">{t("standards.templates.empty")}</p>}
        >
          <ul className="m-0 flex list-none flex-wrap gap-field p-0">
            {(templates.data ?? []).map((template) => (
              <li key={template.id}>
                <Button
                  type="button"
                  variant={template.id === openId ? "secondary" : "outline"}
                  aria-pressed={template.id === openId}
                  onClick={() => setOpenId(template.id)}
                >
                  {template.title}
                </Button>
              </li>
            ))}
          </ul>
        </AsyncSection>

        {[...days.entries()].map(([day, items]) => (
          <section key={day} className="flex flex-col gap-1">
            <h3 className="m-0 font-semibold">
              {t("standards.templates.day", { number: day })}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
              {items.map((item, index) => (
                <li
                  key={`${item.meal_index}-${index}`}
                  className="flex flex-wrap items-center gap-field"
                >
                  <span className="text-muted-foreground">
                    {t("standards.templates.meal", {
                      number: item.meal_index,
                    })}
                  </span>
                  <span className="min-w-0 flex-1 break-words">
                    {item.dish_title}
                  </span>
                  {item.kcal != null ? (
                    <>
                      <RatioBadge ratio={item.ratio ?? null} />
                      <span className="tabular-nums">
                        {t("standards.templates.kcal", {
                          value: formatKcal(item.kcal),
                        })}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("standards.templates.noNumbers")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </FormSheet>
  );
}
