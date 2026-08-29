import type { ReactNode } from "react";

import { ErrorState } from "./ErrorState";

export interface AsyncSectionProps {
  /** Идёт первая загрузка или обновление */
  loading: boolean;
  /** Заглушка в форме будущего содержимого */
  skeleton: ReactNode;
  /** Запрос упал; null — всё в порядке */
  error: { title: string; description?: string } | null;
  retryLabel: string;
  onRetry: () => void;
  /** Показывать нечего: данных нет */
  isEmpty: boolean;
  /** Что показать, когда данных нет и ошибки нет */
  empty: ReactNode;
  children: ReactNode;
}

/**
 * Четыре состояния блока с данными: загрузка, ошибка, пустота, содержимое
 * (правило П15 UI-канона).
 *
 * Существует ради одного правила, которое десять экранов записали по-разному и
 * одинаково неверно: **ошибка не прячет уже показанные данные**. TanStack Query
 * при неудачном обновлении сохраняет прежний ответ и переводит запрос в
 * состояние ошибки — а экраны рисовали ошибку ВМЕСТО списка. Родитель, у
 * которого только что сохранилась запись, видел вместо своих записей красный
 * блок и мог завести их заново.
 *
 * Порядок решений:
 * 1. ошибка и показывать нечего — только ошибка с кнопкой повтора;
 * 2. ошибка, но данные есть — данные, а над ними сообщение с кнопкой повтора;
 * 3. загрузка и данных ещё нет — скелетон;
 * 4. данных нет — пустое состояние;
 * 5. иначе — данные.
 */
export function AsyncSection({
  loading,
  skeleton,
  error,
  retryLabel,
  onRetry,
  isEmpty,
  empty,
  children,
}: AsyncSectionProps) {
  if (error !== null && isEmpty) {
    return (
      <ErrorState
        title={error.title}
        description={error.description}
        retryLabel={retryLabel}
        onRetry={onRetry}
      />
    );
  }

  if (loading && isEmpty) return <>{skeleton}</>;

  return (
    <>
      {error !== null && (
        <ErrorState
          className="mb-block"
          title={error.title}
          description={error.description}
          retryLabel={retryLabel}
          onRetry={onRetry}
        />
      )}
      {isEmpty ? empty : children}
    </>
  );
}
