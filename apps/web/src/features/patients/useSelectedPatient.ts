import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { parseIncoming } from "../calculator/incomingDish";
import { usePatients } from "./usePatients";

/**
 * Ребёнок, о котором сейчас идёт речь.
 *
 * Связь «родитель — ребёнок» многие-ко-многим (раздел 4.2 ТЗ), и это не
 * теоретический случай: при генетических формах эпилепсии на кетотерапии
 * оказываются двое детей одной семьи. Пока выбора не было, интерфейс показывал
 * таким родителям пустой экран.
 *
 * Выбор живёт в адресе (`?patient=`), а не в состоянии компонента: ссылка на
 * экран должна однозначно говорить, о ком она. Один ребёнок выбирается сам —
 * выбирать не из чего.
 *
 * Значение из адреса сверяется со списком доступных: подставленный вручную чужой
 * идентификатор не выбирается. Это удобство, а не защита, — доступ проверяет
 * сервер на каждом запросе (правило 5 CLAUDE.md).
 */
export function useSelectedPatient() {
  const { data, isPending, isError } = usePatients();
  const search = useSearch({ from: "/app/$section" });
  const navigate = useNavigate();

  const items = data?.items ?? [];
  const requested = items.find((patient) => patient.id === search.patient);
  const selected = requested ?? (items.length === 1 ? items[0] : undefined);

  const select = useCallback(
    (patientId: string) => {
      void navigate({
        to: ".",
        search: (previous) => ({
          ...previous,
          patient: patientId,
          // Сбрасывается только то, что принадлежит ребёнку. Задача PDF —
          // всегда о нём: готовый отчёт одного не должен открыться на экране
          // другого. Из открытых объектов о ребёнке лишь своё блюдо (`dish:`);
          // рецепт, продукт и профиль в разделе «Ребёнок» от выбора в шапке
          // не зависят. Иначе первый выбор после ссылки «В калькулятор» терял
          // рецепт, а смена ребёнка закрывала открытую карточку.
          job: undefined,
          item:
            parseIncoming(previous.item)?.kind === "dish"
              ? undefined
              : previous.item,
        }),
      });
    },
    [navigate],
  );

  return {
    patients: items,
    patient: selected ?? null,
    patientId: selected?.id ?? null,
    /** true — детей несколько и ни один не выбран: экран должен попросить выбрать */
    needsChoice:
      !isPending && !isError && items.length > 1 && selected === undefined,
    isPending,
    isError,
    select,
  };
}
