import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Выбранная вкладка экрана — в адресе, а не в состоянии (правило П30 канона).
 *
 * До этого все шесть наборов вкладок приложения хранились в `useState`: ссылку
 * на «назначение пациента» переслать было нельзя, F5 сбрасывал выбор, а
 * быстрая кнопка главной «Записать кетоны» открывала дневник на вкладке
 * «Приступы», потому что параметр адреса не доходил до экрана
 * (`docs/AUDIT_UI_LAYOUT.md`).
 *
 * `key` — `tab` для вкладок экрана, `kind` для разновидности внутри вкладки
 * (вид дневника, выбранный справочник). Смена `tab` сбрасывает `kind`: он
 * принадлежит покинутой вкладке, и оставлять его в адресе — значит хранить
 * мусор, который однажды применится не к тому.
 *
 * Переход — `replace`: вкладка не создаёт запись в истории, иначе «Назад»
 * после осмотра пяти вкладок пришлось бы нажимать пять раз, чтобы уйти с
 * экрана. Ссылка и F5 при этом работают.
 */
export function useSectionTab<T extends string>(
  key: "tab" | "kind",
  values: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const search = useSearch({ from: "/app/$section" });
  const navigate = useNavigate({ from: "/app/$section" });

  const raw = search[key];
  const value = values.find((candidate) => candidate === raw) ?? fallback;

  const set = useCallback(
    (next: T) => {
      void navigate({
        search: (previous) => ({
          ...previous,
          [key]: next,
          ...(key === "tab" ? { kind: undefined } : {}),
        }),
        replace: true,
      });
    },
    [key, navigate],
  );

  return [value, set];
}
