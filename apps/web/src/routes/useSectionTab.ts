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

/**
 * Объект или задача второго уровня внутри раздела (`?item=`).
 *
 * Отдельно от `useSectionTab` потому, что значение здесь не выбирается из
 * короткого списка: это идентификатор открытой позиции. Проверять его на
 * принадлежность списку нечем и не нужно — несуществующий идентификатор
 * отработает как обычный 404 экрана, а не как молчаливый откат к умолчанию.
 *
 * Переход — обычный, не `replace`: открытие карточки продукта это шаг в глубину
 * раздела, и «Назад» браузера обязан возвращать к списку (правило П2 канона).
 * У вкладок наоборот — они историю не копят.
 */
export function useSectionItem(): [
  string | undefined,
  (value?: string) => void,
] {
  const search = useSearch({ from: "/app/$section" });
  const navigate = useNavigate({ from: "/app/$section" });

  const set = useCallback(
    (next?: string) => {
      void navigate({
        search: (previous) => ({ ...previous, item: next }),
      });
    },
    [navigate],
  );

  return [search.item, set];
}

/**
 * Строка поиска раздела — в адресе.
 *
 * Поиск, живущий в `useState`, нельзя ни переслать, ни передать другому
 * экрану. Калькулятор, не нашедший продукт, ведёт в справочник с уже введённым
 * запросом; в состоянии компонента такую ссылку составить нечем.
 *
 * Переход — `replace`: набор строки не должен копить историю, иначе «Назад»
 * пришлось бы нажимать по разу на каждую букву.
 */
export function useSectionQuery(): [string, (value: string) => void] {
  const search = useSearch({ from: "/app/$section" });
  const navigate = useNavigate({ from: "/app/$section" });

  const set = useCallback(
    (next: string) => {
      void navigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          q: next.trim() === "" ? undefined : next,
        }),
      });
    },
    [navigate],
  );

  return [search.q ?? "", set];
}
