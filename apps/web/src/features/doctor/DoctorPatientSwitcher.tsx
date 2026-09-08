import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ketocare/ui";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { usePatient } from "../patients/usePatient";
import { usePatients } from "../patients/usePatients";
import type { PatientView } from "./patientViews";

/**
 * Переход к другому пациенту, не выходя из раздела.
 *
 * Это и есть ответ на вопрос «а если пациентов пятьдесят». Приём идёт пациент
 * за пациентом, и путь «назад в реестр → найти строку → открыть карту → снова
 * открыть тот же раздел» повторяется весь день. Здесь он занимает одно
 * нажатие и три буквы, а открытый раздел сохраняется: врач, сверяющий дневники
 * по когорте, остаётся в дневниках.
 *
 * Отбор идёт на сервере (`usePatients(query)`), поэтому собственный фильтр
 * `cmdk` выключен: он отбирал бы уже отобранное и отвечал бы «не найдено» о
 * пациенте, который на сервере есть, но не попал в первые двести строк, — самый
 * вредный из возможных ответов, потому что выглядит достоверным.
 */
export function DoctorPatientSwitcher({
  patientId,
  view,
}: {
  patientId: string;
  view: PatientView;
}) {
  const { t } = useTranslation("doctor");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const debouncedQuery = useDebouncedValue(query, 300);
  const patients = usePatients(debouncedQuery);
  const current = usePatient(patientId);

  const items = patients.data?.items ?? [];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Запрос сбрасывается при закрытии: открытый в следующий раз список
        // обязан показывать когорту, а не остаток прошлого поиска.
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          // Ширина — из той же шкалы, что у полей выбора (`--container-field-medium`):
          // имя пациента бывает длинным, а шапка кабинета не резиновая.
          className="min-h-touch max-w-field-medium justify-start gap-field"
        >
          <span className="truncate font-medium">
            {current.data?.full_name ?? t("workspace.switcher.loading")}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="sr-only">{t("workspace.switcher.label")}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("workspace.switcher.placeholder")}
          />
          <CommandList>
            {/* Пока идёт запрос, «не найдено» не показывается: это утверждение
                о когорте, а не о состоянии загрузки (правило П15 канона). */}
            {!patients.isPending && (
              <CommandEmpty>{t("workspace.switcher.empty")}</CommandEmpty>
            )}
            <CommandGroup>
              {items.map((patient) => (
                <CommandItem
                  key={patient.id}
                  value={patient.id}
                  onSelect={() => {
                    setOpen(false);
                    void navigate({
                      to: "/app/patients/$patientId/$view",
                      params: { patientId: patient.id, view },
                    });
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={
                      patient.id === patientId
                        ? "size-4 shrink-0"
                        : "size-4 shrink-0 opacity-0"
                    }
                  />
                  <span className="truncate">{patient.full_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
