import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

/**
 * Пациенты, доступные текущему пользователю.
 *
 * Область видимости определяет сервер (связи + patient_scope), клиент её не
 * сужает и не расширяет: фронтовые проверки — это UX, не безопасность.
 */
/**
 * Пациенты, доступные пользователю.
 *
 * `query` уходит на сервер, а не отбирает уже загруженное: страница отдаёт
 * первые 200 строк, и поиск по ним отвечал «не найдено» о пациенте, который
 * есть, — самый вредный из возможных ответов, потому что выглядит достоверным.
 */
/**
 * `therapy` — рабочий список («active») или завершившие терапию («ended»);
 * не задан — все, как у семьи и у выбора пациента (вопрос 18, ADR-0050).
 * Отбор делает сервер: страница отдаёт 200 строк, и отбор на клиенте
 * показал бы пустой рабочий список при двухстах завершивших.
 */
export type TherapyFilter = "active" | "ended";

export function usePatients(query = "", therapy?: TherapyFilter) {
  const needle = query.trim();

  return useQuery({
    queryKey: ["patients", needle, therapy ?? "all"],
    // Прошлая выдача держится, пока грузится новая: иначе таблица мигает
    // пустотой на каждой набранной букве.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/patients", {
        params: {
          query: {
            limit: 200,
            offset: 0,
            ...(needle === "" ? {} : { q: needle }),
            ...(therapy === undefined ? {} : { therapy }),
          },
        },
      });
      if (error || !data) throw error ?? new Error("Empty patients response");
      return data;
    },
  });
}
