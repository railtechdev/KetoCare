import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { DEFAULT_PATIENT_VIEW, type PatientView } from "./patientViews";

/**
 * Ссылка на раздел карты пациента.
 *
 * Существует по той же причине, что и `SectionLink`: путь к разделу пациента
 * повторяется в реестре, в очереди главной, в навигации рабочего места и в
 * пустых состояниях, а умолчание «какой раздел открыть, если не сказано» —
 * решение, а не мелочь. Записанное в одном месте, оно и меняется в одном.
 *
 * Параметры адреса при переходе гасятся, кроме `job`: вид дневника (`kind`)
 * принадлежит покинутому разделу и на другом означал бы уже не то, а сборка
 * отчёта живёт на сервере — уйти из отчёта в дневники и вернуться, потеряв
 * готовый файл, значит заказать его второй раз (ради этого `?job=` и заведён).
 *
 * `item` задаётся явно там, где переход ведёт к конкретному предмету:
 * блюдо пациента открывается в калькуляторе ЕГО карты — только там у расчёта
 * есть кетосоотношение из назначения и список исключённых продуктов.
 */
export function PatientViewLink({
  patientId,
  view = DEFAULT_PATIENT_VIEW,
  item,
  children,
  className,
  current,
  onClick,
  "aria-label": ariaLabel,
}: {
  patientId: string;
  view?: PatientView;
  /** Предмет, который нужно открыть в разделе: блюдо в калькуляторе карты */
  item?: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  /**
   * Открытый раздел. Ставится явно, а не берётся у роутера: «активной» он
   * считает ссылку по совпадению адреса ВМЕСТЕ с параметрами поиска
   * (`activeOptions.includeSearch` включён по умолчанию), и открытый раздел
   * переставал бы называться собой из-за постороннего `?job=` в адресе. То,
   * что говорит врачу и скринридеру, где он находится, не должно зависеть от
   * умолчаний библиотеки.
   */
  current?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to="/app/patients/$patientId/$view"
      params={{ patientId, view }}
      search={(previous) => ({ job: previous.job, item })}
      className={className}
      aria-label={ariaLabel}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
