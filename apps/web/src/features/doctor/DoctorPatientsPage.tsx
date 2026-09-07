import { SplitView } from "@ketocare/ui";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { usePatients } from "../patients/usePatients";
import { PatientCard } from "./PatientCard";
import { PatientRail } from "./PatientRail";
import { PatientsListView } from "./PatientsListView";

/**
 * Кабинет врача: список пациентов и карта пациента (раздел 8.1 ТЗ, раздел
 * `/app (doctor)`).
 *
 * Список и карта живут в одном разделе маршрута: `/app/$section` не знает о
 * вложенных путях. Но кто открыт, хранится в адресе (`?patient=`), а не в
 * состоянии экрана — правило П1 канона. До этого врач не мог ни переслать
 * коллеге ссылку на карту, ни обновить страницу: F5 выбрасывал в список, а
 * «Назад» браузера уводил из кабинета. Заодно ломалось обещание, записанное в
 * `PatientCard`: собранная там ссылка `?tab=prescription` не содержала
 * пациента вовсе.
 *
 * `useSelectedPatient` здесь не подходит, хотя параметр адреса тот же: он
 * выбирает единственного ребёнка сам, потому что родителю выбирать не из чего.
 * Врачу с одним прикреплённым пациентом нужен список — умолчание другое, и
 * подменять его флагом значило бы вписать в общий хук две разные роли.
 */
export function DoctorPatientsPage() {
  const search = useSearch({ from: "/app/$section" });
  const navigate = useNavigate({ from: "/app/$section" });
  const patients = usePatients();

  // Открытие карты делает ссылка в имени пациента; здесь остаётся только
  // возврат к списку — его требует `PageLayout onBack` (правило П2).
  const select = useCallback(
    (patientId?: string) => {
      void navigate({
        search: (previous) => ({ ...previous, patient: patientId }),
      });
    },
    [navigate],
  );

  // Идентификатор из адреса сверяется со списком доступных: подставленный
  // вручную чужой откроет список, а не карту. Это удобство, а не защита —
  // доступ проверяет сервер на каждом запросе (правило 5 CLAUDE.md).
  const selected =
    (patients.data?.items ?? []).find((item) => item.id === search.patient) ??
    null;

  // Ничего не выбрано — реестр во всю ширину. Выбран пациент: на узком экране
  // только его карта (ровно как было), с 1280 px — карта и перечень «кто
  // следующий» рядом. Разветвление делает `SplitView`, и делает его в JS: на
  // телефоне лишней половины не существует, а не прячется классом.
  return (
    <SplitView
      list={<PatientsListView />}
      rail={selected === null ? null : <PatientRail selectedId={selected.id} />}
      detail={
        selected === null ? null : (
          <PatientCard patient={selected} onBack={() => select(undefined)} />
        )
      }
    />
  );
}
