import { useNavigate } from "@tanstack/react-router";

import { useAddressState } from "../../routes/useSectionTab";
import { CatalogueMergeScreen } from "./CatalogueMergeScreen";
import { StandardsPanel } from "./StandardsPanel";

/**
 * Вид «Стандарты питания» справочника продуктов: перечень стандартов или
 * экран сборки рабочего справочника (ADR-0068).
 *
 * Сборка — объект второго уровня со своим адресом (`?kind=merge&standard=`,
 * правило П1): ссылку можно переслать, F5 не сбрасывает превью. Переход —
 * обычный, не `replace`: это шаг в глубину, и «Назад» браузера возвращает к
 * перечню (П2). Один на справочник специалиста и раздел администратора.
 */
export function StandardsSection({
  onOpen,
}: {
  /** Показать продукты стандарта в справочнике */
  onOpen: (standardId: string) => void;
}) {
  const address = useAddressState();
  const navigate = useNavigate();

  if (address.kind === "merge" && address.standard !== undefined) {
    return <CatalogueMergeScreen targetId={address.standard} />;
  }

  return (
    <StandardsPanel
      onOpen={onOpen}
      onMerge={(standardId) =>
        void navigate({
          to: ".",
          search: (previous) => ({
            ...previous,
            kind: "merge",
            standard: standardId,
            sources: undefined,
          }),
        })
      }
    />
  );
}
