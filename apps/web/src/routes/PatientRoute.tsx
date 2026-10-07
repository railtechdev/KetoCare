import {
  AsyncSection,
  Button,
  EmptyState,
  Skeleton,
  Workspace,
} from "@ketocare/ui";
import { UserX } from "lucide-react";
import { Outlet, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useSession } from "../features/auth/useSession";
import { PatientNav } from "../features/doctor/PatientNav";
import { usePatient } from "../features/patients/usePatient";
import { SectionLink } from "../components/SectionLink";
import { errorCodeOf, errorMessageOf } from "../lib/api";
import { queryState } from "../lib/queryState";

/**
 * Рабочее место пациента: навигация по его разделам и открытый раздел.
 *
 * Зачем это устроено так. Карта пациента жила вкладками внутри раздела
 * «Пациенты» и делила с ним адрес: `?patient=<id>&tab=<вкладка>`. Пока
 * пациентов восемь, это работало; на пятидесяти рассыпается сразу в двух
 * местах. Перечень пациентов рядом с картой (`SplitView`) превращался в список
 * без поиска, который нужно листать, и стоил по запросу сводки на каждого
 * пациента при каждом открытии карты. А вкладок не могло быть больше шести —
 * седьмой негде встать в полосе, — при том что карта уже держала семь разных
 * дел, и «Профиль» ютился внутри «Сводки».
 *
 * Теперь пациент — уровень адреса (`/app/patients/<id>/<раздел>`), а не
 * параметр списка. Врач входит в карту и работает в ней; навигация приложения
 * остаётся на месте, сжимаясь до полосы значков (`AppLayout`), — и это
 * единственный видимый признак того, что он уровнем глубже.
 *
 * Пациент грузится ОДНИМ запросом по идентификатору из адреса, а не ищется в
 * списке: карта, открытая по ссылке, не ждёт двухсот строк и работает для
 * пациента, который в первые двести не попал.
 */
export function PatientRoute() {
  const { t } = useTranslation("doctor");
  const { patientId } = useParams({ from: "/app/patients/$patientId" });
  const { session } = useSession();
  const patient = usePatient(patientId);

  // Карты нет или к ней нет доступа (ведение передали коллеге, ссылка чужая).
  // Повтор этого не исправит: прежде экран предлагал только «Повторить», без
  // заголовка и без пути назад, а переключатель в шапке вечно «загружал».
  // Различать «нет» и «нельзя» не нужно — сервер намеренно отвечает так, чтобы
  // по ответу нельзя было узнать, существует ли чужой пациент.
  const code = errorCodeOf(patient.error);
  if (
    patient.data === undefined &&
    (code === "not_found" || code === "forbidden")
  ) {
    return (
      <div className="flex max-w-form flex-col gap-block">
        <h1 className="sr-only">{t("workspace.missing.title")}</h1>
        <EmptyState
          icon={UserX}
          title={t("workspace.missing.title")}
          description={t("workspace.missing.body")}
          action={
            <Button asChild>
              <SectionLink section="patients" exact>
                {t("workspace.missing.toList")}
              </SectionLink>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <AsyncSection
      {...queryState(patient)}
      skeleton={<WorkspaceSkeleton />}
      error={
        patient.isError
          ? {
              title: t("workspace.loadError"),
              description:
                errorMessageOf(patient.error) ?? t("common:errors.unexpected"),
            }
          : null
      }
      retryLabel={t("common:actions.retry")}
      onRetry={() => void patient.refetch()}
      isEmpty={patient.data === undefined}
      empty={null}
    >
      {patient.data !== undefined && (
        <Workspace
          navLabel={t("workspace.navLabel", { name: patient.data.full_name })}
          nav={<PatientNav patient={patient.data} role={session?.role} />}
        >
          {/* Раздел рисует себя вместе со своим заголовком: у каждого своё
              название, и общий заголовок здесь означал бы, что шапка страницы
              не отвечает на вопрос «что я сейчас смотрю». */}
          <Outlet />
        </Workspace>
      )}
    </AsyncSection>
  );
}

function WorkspaceSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("states.loadingSection")}
      className="flex flex-col gap-screen"
    >
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
