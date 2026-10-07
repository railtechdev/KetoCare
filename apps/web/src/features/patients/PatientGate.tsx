import { AsyncSection, Button, EmptyState, Skeleton } from "@ketocare/ui";
import { Baby, Users } from "lucide-react";
import { Fragment, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { usePatients } from "./usePatients";
import { useSelectedPatient } from "./useSelectedPatient";

/**
 * Экран о конкретном ребёнке.
 *
 * Определение ребёнка вынесено сюда из самих экранов по двум причинам. Первая:
 * правило одно, а экранов четыре — разойтись им нельзя. Вторая: экран, знающий
 * про адресную строку, невозможно отрисовать в тесте без роутера, и проверка
 * начинает зависеть от способа выбора, а не от того, что показано.
 *
 * Ниже по дереву `patientId` — обычная строка, и экран не думает о том, откуда
 * она взялась.
 */
export function PatientGate({
  render,
}: {
  render: (patientId: string) => ReactElement;
}) {
  const { t } = useTranslation();
  const {
    patientId,
    patients: available,
    needsChoice,
    select,
  } = useSelectedPatient();
  const patients = usePatients();

  // Пять состояний — у `AsyncSection` (правило П15), а не своей цепочкой.
  // Прежняя цепочка «грузится → ошибка → …» нарушала его дважды: без сети
  // скелетон крутился вечно (запрос на паузе, а не в загрузке), а неудачное
  // ОБНОВЛЕНИЕ списка детей прятало уже открытый экран за сообщением об
  // ошибке — родитель терял недописанную форму.
  return (
    <AsyncSection
      {...queryState(patients)}
      skeleton={
        <div
          className="flex max-w-form flex-col gap-block"
          role="status"
          aria-busy="true"
        >
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
      error={
        patients.isError
          ? {
              title: t("patientGate.errorTitle"),
              description:
                errorMessageOf(patients.error) ?? t("errors.unexpected"),
            }
          : null
      }
      retryLabel={t("actions.retry")}
      onRetry={() => void patients.refetch()}
      isEmpty={patients.data === undefined}
      empty={null}
    >
      <Chosen
        patientId={patientId}
        available={available}
        needsChoice={needsChoice}
        select={select}
        render={render}
      />
    </AsyncSection>
  );
}

function Chosen({
  patientId,
  available,
  needsChoice,
  select,
  render,
}: {
  patientId: string | null;
  available: readonly { id: string; full_name: string }[];
  needsChoice: boolean;
  select: (patientId: string) => void;
  render: (patientId: string) => ReactElement;
}) {
  const { t } = useTranslation();

  if (needsChoice) {
    // Выбор предлагается здесь же, а не отсылкой «в списке наверху страницы»:
    // переключатель в шапке есть только у родителя, и у врача, попавшего сюда
    // из меню, отсылать было бы некуда. Пустое состояние без выхода — тупик,
    // и это тот же тупик, который экран должен закрывать (правило П15).
    return (
      <EmptyState
        // Ширина ограничена: экраны этого гейта рисуются вне `PageLayout`, и
        // без предела пунктирная рамка с двумя кнопками растягивалась во всю
        // рабочую область — 1616 x 290 px на мониторе 1920 под фразу в одну
        // строку.
        className="max-w-form"
        // Это и есть экран: заголовка на странице больше нет ни одного, а
        // родитель попадает сюда первым делом после входа.
        headingLevel={1}
        icon={Users}
        title={t("patientGate.chooseTitle")}
        description={t("patientGate.chooseBody")}
        action={
          <ul className="m-0 flex list-none flex-wrap justify-center gap-field p-0">
            {available.map((patient) => (
              <li key={patient.id}>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-touch"
                  onClick={() => select(patient.id)}
                >
                  {patient.full_name}
                </Button>
              </li>
            ))}
          </ul>
        }
      />
    );
  }

  if (patientId === null) {
    return (
      <EmptyState
        className="max-w-form"
        headingLevel={1}
        icon={Baby}
        title={t("patientGate.noneTitle")}
        description={t("patientGate.noneBody")}
        action={
          <Button asChild>
            <SectionLink section="child">
              {t("patientGate.addChild")}
            </SectionLink>
          </Button>
        }
      />
    );
  }

  // Ключ — ребёнок. Выбор в шапке меняет `?patient=`, а маршрут раздела
  // остаётся тем же, и без ключа React сохранял экран вместе с состоянием
  // прежнего ребёнка: калькулятор держал его кетосоотношение и калорийность и
  // выносил вердикт против чужого назначения, помощник — открытый разговор. Тот
  // же дефект, что в карте пациента у врача (`PatientViewRoute`). Цена ключа —
  // вместе с экраном сбрасывается то, что он держит в состоянии, а не в
  // адресе: дата меню, периоды дневника и отчёта.
  return <Fragment key={patientId}>{render(patientId)}</Fragment>;
}
