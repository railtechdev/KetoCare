import { Button, WarningBanner } from "@ketocare/ui";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { type MenuItem, useRefreshItem } from "./useMenu";

/**
 * «Состав блюда изменили после того, как его поставили в меню» — и что с этим
 * делать (аудит 26.11.2026, 1.3).
 *
 * Позиция дня хранит снимок состава (ADR-0016), и правка блюда в день не
 * попадает. Прежде здесь стояла серая строка «Рецепт изменился…» без действия,
 * а «Что взвесить» продолжало показывать старые граммы — при том что состав
 * правят, когда в нём нашли ошибку. Теперь у несъеденного блюда — кнопка,
 * которая берёт новый состав (та же ручка, что «Взять новый состав» в
 * кабинете, ADR-0089). Съеденное не обновляется: это запись о том, что ребёнок
 * ел, — об этом и сказано.
 */
export function StaleItemNote({
  item,
  patientId,
  day,
}: {
  item: MenuItem;
  patientId: string;
  day: string;
}) {
  const { t } = useTranslation();
  const refresh = useRefreshItem(patientId, day);
  if (!item.changed_since_saved) return null;

  return (
    <div className="flex flex-col gap-1 pl-8 text-sm">
      <p className="m-0 text-warning-strong">
        {item.eaten ? t("menu.stale.eaten") : t("menu.stale.body")}
      </p>
      {!item.eaten && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-touch self-start"
          disabled={refresh.isPending}
          aria-busy={refresh.isPending || undefined}
          onClick={() => refresh.mutate(item.id)}
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          {refresh.isPending
            ? t("menu.stale.refreshing")
            : t("menu.stale.refresh")}
        </Button>
      )}
      {refresh.isError && (
        <WarningBanner level="danger" title={t("menu.stale.failed")}>
          {errorMessageOf(refresh.error) ?? t("home.loadErrorHint")}
        </WarningBanner>
      )}
    </div>
  );
}
