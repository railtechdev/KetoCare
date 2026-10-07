import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ketocare/ui";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";

export interface PersonOption {
  id: string;
  name: string;
  /** Вторая строка варианта: роль, почта — то, что различает тёзок */
  detail?: string;
}

/**
 * Выбор человека поиском, а не перечислением и не вводом идентификатора
 * (правило П42 канона).
 *
 * До него автор действия в журнале аудита задавался UUID, набранным руками, —
 * взять его администратору было неоткуда, кроме строки того же журнала, — а
 * коллега в карте пациента выбирался из `select` всей клиники без поиска.
 *
 * Механика та же, что у `PatientPicker`: `Command` + `Popover` кита. Отличие в
 * том, кто отбирает. `filter="server"` — список приходит уже отобранным по
 * запросу (учётные записи: их сотни), и собственный фильтр `cmdk` выключен:
 * он отбирал бы отобранное и отвечал бы «не найдено» о том, кто есть на
 * сервере. `filter="local"` — список полный и короткий (врачи и диетологи
 * клиники приходят целиком, без страницы), и отбор по нему честен.
 *
 * «Не найдено» говорится только по ответу сервера: ни загрузка, ни отказ таким
 * ответом не являются (правило П15).
 */
export function PersonPicker({
  id,
  label,
  hint,
  selectedId,
  selectedName,
  placeholder,
  people,
  filter,
  query,
  onQueryChange,
  status,
  onRetry,
  onSelect,
  texts,
}: {
  /** id кнопки: на неё ведут подпись и сводка ошибок формы */
  id: string;
  label: string;
  hint?: string;
  selectedId?: string;
  /** Что написать на кнопке, когда выбор сделан */
  selectedName?: string;
  /** Что написать на кнопке, когда выбора нет */
  placeholder: string;
  people: readonly PersonOption[];
  filter: "server" | "local";
  query: string;
  onQueryChange: (value: string) => void;
  status: "pending" | "error" | "success";
  onRetry: () => void;
  /** `null` — выбор снят (если показан пункт `texts.clear`) */
  onSelect: (id: string | null) => void;
  texts: {
    search: string;
    empty: string;
    loadError: string;
    retry: string;
    /** Подпись пункта «снять выбор»; без неё пункта нет */
    clear?: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const hintId = `${id}-hint`;
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;

  return (
    <div className="flex flex-col gap-field">
      <Label id={labelId} htmlFor={id}>
        {label}
      </Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Открытый в следующий раз список показывает всех, а не остаток
          // прошлого поиска.
          if (!next) onQueryChange("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            // Имя кнопки — подпись И выбранное: одной подписи скринридер
            // прочёл бы «Автор действия, кнопка», не сказав, кто выбран.
            aria-labelledby={`${labelId} ${valueId}`}
            aria-describedby={hint ? hintId : undefined}
            className="min-h-touch w-full justify-start gap-field sm:max-w-field-wide"
          >
            <span
              id={valueId}
              className={
                selectedId === undefined
                  ? "truncate text-muted-foreground"
                  : "truncate"
              }
            >
              {selectedId === undefined
                ? placeholder
                : (selectedName ?? selectedId)}
            </span>
            <ChevronsUpDown
              aria-hidden="true"
              className="ml-auto size-4 shrink-0 text-muted-foreground"
            />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-72 p-0">
          <Command shouldFilter={filter === "local"}>
            <CommandInput
              value={query}
              onValueChange={onQueryChange}
              placeholder={texts.search}
            />
            <CommandList>
              {status === "error" ? (
                <div
                  role="status"
                  className="flex flex-col items-start gap-field p-4 text-sm"
                >
                  <span className="text-foreground">{texts.loadError}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRetry}
                  >
                    {texts.retry}
                  </Button>
                </div>
              ) : (
                status === "success" && (
                  <CommandEmpty>{texts.empty}</CommandEmpty>
                )
              )}
              <CommandGroup>
                {texts.clear !== undefined && selectedId !== undefined && (
                  <CommandItem
                    value={`clear ${texts.clear}`}
                    onSelect={() => {
                      setOpen(false);
                      onSelect(null);
                    }}
                  >
                    <X aria-hidden="true" className="size-4 shrink-0" />
                    <span>{texts.clear}</span>
                  </CommandItem>
                )}
                {people.map((person) => (
                  <CommandItem
                    key={person.id}
                    // Значение — то, по чему ищет локальный отбор: имя и
                    // вторая строка, а не идентификатор.
                    value={`${person.name} ${person.detail ?? ""} ${person.id}`}
                    onSelect={() => {
                      setOpen(false);
                      onSelect(person.id);
                    }}
                  >
                    <Check
                      aria-hidden="true"
                      className={
                        person.id === selectedId
                          ? "size-4 shrink-0"
                          : "size-4 shrink-0 opacity-0"
                      }
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{person.name}</span>
                      {person.detail !== undefined && (
                        <span className="truncate text-xs text-muted-foreground">
                          {person.detail}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {hint && (
        <p id={hintId} className="m-0 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
