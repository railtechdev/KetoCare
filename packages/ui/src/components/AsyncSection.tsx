import type { ReactNode } from "react";

import { ErrorState } from "./ErrorState";
import { StatusNote } from "./StatusNote";

export interface AsyncSectionProps {
  /** Идёт первая загрузка или обновление */
  loading: boolean;
  /** Заглушка в форме будущего содержимого */
  skeleton: ReactNode;
  /** Запрос упал; null — всё в порядке */
  error: { title: string; description?: string } | null;
  /**
   * Запрос ждёт связи и показывать ещё нечего; null — не ждёт.
   *
   * Это не ошибка и не загрузка: без сети запрос не уходит и не отказывает, а
   * стоит на паузе (`fetchStatus: "paused"`) и продолжится сам, когда связь
   * вернётся. Повторять нечего, поэтому кнопки здесь нет.
   *
   * Работает в паре с `loading`, и `loading` обязан быть `isPending`, то есть
   * «данных ещё нет». На `isLoading` опереться нельзя: он равен
   * `isPending && isFetching`, а на паузе запрос не идёт — состояние не
   * показалось бы никогда. Опереться на `isEmpty` тоже нельзя: экраны, где
   * пустоты не бывает, передают его постоянным `false`.
   */
  waiting?: string | null;
  retryLabel: string;
  onRetry: () => void;
  /** Показывать нечего: данных нет */
  isEmpty: boolean;
  /** Что показать, когда данных нет и ошибки нет */
  empty: ReactNode;
  children: ReactNode;
}

/**
 * Пять состояний блока с данными: загрузка, ожидание связи, ошибка, пустота,
 * содержимое (правило П15 UI-канона).
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
 * 3. ждём связи и данных ещё нет — сказать об этом словами;
 * 4. загрузка и данных ещё нет — скелетон;
 * 5. данных нет — пустое состояние;
 * 6. иначе — данные.
 *
 * Ожидание связи стоит раньше скелетона намеренно: на паузе запрос не идёт, и
 * скелетон обещал бы загрузку, которой нет. Экран сводки в Mini App показывал
 * в этом состоянии пустоту — ни объяснения, ни выхода.
 */
export function AsyncSection({
  loading,
  skeleton,
  error,
  waiting = null,
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

  if (waiting !== null && loading) return <StatusNote>{waiting}</StatusNote>;

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
