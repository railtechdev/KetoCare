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
  cn,
} from "@ketocare/ui";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { Patient } from "../doctor/types";
import { usePatients } from "./usePatients";

/**
 * Выбор пациента поиском, а не перечислением.
 *
 * Перечисление здесь не работает, и это измерено: на когорте в полсотни
 * прежний выбор рисовал пятьдесят кнопок в рамке высотой 990 px внутри окна
 * 900 px, без поиска и в алфавитном порядке — то есть первым стоял тот, чья
 * фамилия начинается на «А». Ответ на «кого выбрать» превращался в
 * пролистывание.
 *
 * Отбор идёт на сервере, поэтому собственный фильтр `cmdk` выключен: он
 * отбирал бы уже отобранное и отвечал бы «не найдено» о пациенте, который на
 * сервере есть, но не попал в первые двести строк, — самый вредный из
 * возможных ответов, потому что выглядит достоверным.
 *
 * Компонент один на два места: переключатель в шапке карты и передача состава
 * из общего калькулятора. Два поиска по одной когорте разошлись бы — один
 * спрашивал бы сервер, другой фильтровал загруженное.
 */
export function PatientPicker({
  selectedId,
  onSelect,
  label,
  trigger,
  className,
}: {
  /** Кто выбран сейчас; отмечается галочкой в списке */
  selectedId?: string;
  onSelect: (patient: Patient) => void;
  /** Подпись элемента управления для скринридера */
  label: string;
  /** Что показать на кнопке: имя выбранного или приглашение выбрать */
  trigger: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation("doctor");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const debouncedQuery = useDebouncedValue(query, 300);
  const patients = usePatients(debouncedQuery);
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
          variant="outline"
          // Ширина — из той же шкалы, что у полей выбора: имя пациента бывает
          // длинным, а место под элемент управления не резиновое.
          className={cn(
            "min-h-touch max-w-field-medium justify-start gap-field",
            className,
          )}
        >
          <span className="truncate">{trigger}</span>
          <ChevronsUpDown
            aria-hidden="true"
            className="ml-auto size-4 shrink-0 text-muted-foreground"
          />
          <span className="sr-only">{label}</span>
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
            {/* «Не найдено» — утверждение о когорте, и говорить его можно
                только тогда, когда сервер ответил пустым списком (правило П15).
                Ни загрузка, ни отказ сети таким ответом не являются: врач,
                читающий «Пациенты не найдены» вместо сообщения о сбое, решает,
                что пациента нет, — и ответ этот выглядит достоверным. Тот же
                довод, по которому поиск ушёл на сервер. */}
            {patients.isError ? (
              <div
                role="status"
                className="flex flex-col items-start gap-field p-4 text-sm"
              >
                <span className="text-foreground">
                  {t("workspace.switcher.loadError")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void patients.refetch()}
                >
                  {t("common:actions.retry")}
                </Button>
              </div>
            ) : (
              !patients.isPending && (
                <CommandEmpty>{t("workspace.switcher.empty")}</CommandEmpty>
              )
            )}
            <CommandGroup>
              {items.map((patient) => (
                <CommandItem
                  key={patient.id}
                  value={patient.id}
                  onSelect={() => {
                    setOpen(false);
                    onSelect(patient);
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={
                      patient.id === selectedId
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
