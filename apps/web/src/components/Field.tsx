import {
  Button,
  DateCalendar,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "@ketocare/ui";
import { CalendarDays, Eye, EyeOff } from "lucide-react";
import {
  Children,
  Fragment,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

/**
 * Ширина поля показывает, сколько ждут ввести.
 *
 * Пока все поля были одной ширины, «Пол» с двумя вариантами, дата рождения и
 * рост в три цифры растягивались на 672 px наравне с именем — и поле переставало
 * что-либо подсказывать. Приём и шкала взяты у GOV.UK Design System
 * (`govuk-input--width-*`), значения — в токенах темы.
 *
 * Ограничение действует с ширины `sm` и выше: на телефоне поле занимает строку
 * целиком, там сужать нечего.
 */
export type FieldWidth =
  "tiny" | "narrow" | "date" | "medium" | "wide" | "full";

const WIDTH_CLASS: Record<FieldWidth, string> = {
  tiny: "sm:max-w-field-tiny",
  narrow: "sm:max-w-field-narrow",
  date: "sm:max-w-field-date",
  medium: "sm:max-w-field-medium",
  wide: "sm:max-w-field-wide",
  full: "",
};

interface FieldBaseProps {
  label: string;
  /** Текст ошибки; связывается с полем через aria-describedby */
  error?: ReactNode;
  /** Пояснение под полем: единицы, формат, откуда взять значение */
  hint?: ReactNode;
  /** Помечается необязательное поле, а не обязательное звёздочкой:
      в клинических формах обязательно почти всё (правило П7 UI-канона). */
  optional?: boolean;
  /** Сколько знаков ждут ввести; по умолчанию — вся ширина формы */
  width?: FieldWidth;
}

/**
 * Поля формы: строка, список, многострочный текст.
 *
 * Разметка целиком берётся у кита (`Input`, `Select`, `Textarea`, `Label`);
 * здесь остаётся только то, чего в ките нет и что важнее вида, — связь подписи,
 * пояснения и сообщения об ошибке. Пока эта обвязка была скопирована по трём
 * файлам, исправление связи в одной копии не доходило до двух других, и
 * незрячий пользователь узнавал об ошибке не везде.
 *
 * `ref` передаётся обычным свойством: под React 19 функциональный компонент
 * получает его напрямую, и `forwardRef` больше не нужен.
 */
export const FIELD_CONTROL =
  "min-h-touch w-full rounded-lg border border-input bg-card px-3 py-2.5 text-foreground";

function getDescribedBy(
  id: string | undefined,
  error: ReactNode,
  hint: ReactNode,
) {
  const parts = [
    error ? `${id}-error` : null,
    hint ? `${id}-hint` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(" ") : undefined;
}

function FieldShell({
  label,
  error,
  hint,
  optional,
  id,
  children,
}: FieldBaseProps & { id?: string; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    // gap-field — между подписью, полем и пояснением; mb-section — между самими
    // полями. Отступ снизу был потерян при переходе на кит, и поля в формах
    // слиплись: пояснение под одним полем читалось как подпись к следующему.
    //
    // `data-slot="field"` — чтобы ряд управления мог этот отступ снять. В
    // строке (панель отбора, навигатор дня) он вреден: выравнивание идёт по
    // низу, и соседние кнопки равняются на нижний край ОТСТУПА, а не поля —
    // ровно отсюда разъезд в 16 px между полем даты и стрелками.
    <div data-slot="field" className="mb-section flex flex-col gap-field">
      {/* Подпись кита — flex-контейнер с содержимым в одну строку, и в узкой
          колонке она выталкивала блок за край экрана. Замер ночного прогона на
          360 px: «Кетосоотношение» — 134 px в колонке 131 px, +3 px у подписи
          и у обоих её родителей, страница уезжает вбок.

          Поэтому два класса, и оба нужны: `flex-wrap` переносит пометку
          «(необязательно)» на свою строку, а перенос ВНУТРИ слова снимает
          минимальную ширину содержимого. Именно `anywhere`, а не
          `break-words`: последний разрешает разрыв при отрисовке, но по
          спецификации НЕ уменьшает min-content, и текст-элемент внутри flex
          по-прежнему распирал подпись — прогон это и показал, те же 131→134.

          Кит править нельзя, классы передаются отсюда. */}
      <Label htmlFor={id} className="flex-wrap wrap-anywhere">
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground">
            {t("form.optional")}
          </span>
        )}
      </Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  optional,
  id,
  className,
  width = "full",
  type,
  ...props
}: FieldBaseProps & ComponentProps<"input">) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);

  if (type === "date") {
    return (
      <FieldShell
        label={label}
        error={error}
        hint={hint}
        optional={optional}
        id={id}
      >
        <DateInput
          id={id}
          error={error}
          hint={hint}
          width={width}
          className={className}
          {...props}
        />
      </FieldShell>
    );
  }

  const isPassword = type === "password";
  const effectiveType = isPassword
    ? showPassword
      ? "text"
      : "password"
    : type;

  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      optional={optional}
      id={id}
    >
      {isPassword ? (
        <div className={cn("relative flex items-center", WIDTH_CLASS[width])}>
          <Input
            id={id}
            type={effectiveType}
            aria-invalid={error ? true : undefined}
            aria-describedby={getDescribedBy(id, error, hint)}
            className={cn("min-h-touch pr-12 w-full", className)}
            {...props}
          />
          <button
            type="button"
            aria-label={
              showPassword
                ? t("actions.hidePassword")
                : t("actions.showPassword")
            }
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-0 flex min-h-touch min-w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-lg"
          >
            {showPassword ? (
              <EyeOff className="size-5" aria-hidden="true" />
            ) : (
              <Eye className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>
      ) : (
        <Input
          id={id}
          type={effectiveType}
          aria-invalid={error ? true : undefined}
          aria-describedby={getDescribedBy(id, error, hint)}
          className={cn("min-h-touch", WIDTH_CLASS[width], className)}
          {...props}
        />
      )}
    </FieldShell>
  );
}

/** «2026-11-11» → «11.11.2026». */
function isoToText(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

/**
 * Набранное → «ГГГГ-ММ-ДД» или `null`. Понимает «11.11.2026», «1.9.2026»,
 * разделители «/» и «-», и ISO как есть. Несуществующая дата — `null`.
 */
function textToIso(text: string): string | null {
  const value = text.trim();
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const ru = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value);
  if (iso) [year, month, day] = [+iso[1]!, +iso[2]!, +iso[3]!];
  else if (ru) [day, month, year] = [+ru[1]!, +ru[2]!, +ru[3]!];
  else return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function isoToDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? new Date(+match[1]!, +match[2]! - 1, +match[3]!) : undefined;
}

function dateToIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Поле даты: набор с клавиатуры «ДД.ММ.ГГГГ» и календарь кита рядом
 * (docs/PLAN_UI_ORDER_2026-11.md, этап 2) вместо системного поля, которое
 * выглядит по-разному в каждом браузере и пишет дату по языку системы.
 *
 * Значение живёт в скрытом системном `<input type="date">`: его регистрирует
 * react-hook-form, у него `min`/`max`, он получает событие `input`. Вызовы
 * поля не меняются.
 */
function DateInput({
  id,
  error,
  hint,
  width,
  className,
  ref,
  onChange,
  disabled,
  min,
  max,
  "aria-describedby": describedBy,
  ...props
}: {
  error?: ReactNode;
  hint?: ReactNode;
  width: keyof typeof WIDTH_CLASS;
} & Omit<ComponentProps<"input">, "type">) {
  const { t } = useTranslation();
  const native = useRef<HTMLInputElement | null>(null);
  const visible = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(() =>
    isoToText(String(props.value ?? props.defaultValue ?? "")),
  );
  const [open, setOpen] = useState(false);
  const shown = useRef("");

  // Значение могли записать в обход набора — `reset()`, значения по умолчанию
  // react-hook-form, управляемый `value`. Текст догоняет элемент, только когда
  // изменился сам элемент: иначе недонабранная дата стиралась бы на лету.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const value = native.current?.value ?? "";
    if (value !== shown.current) {
      shown.current = value;
      setText(isoToText(value));
    }
  });

  function write(iso: string) {
    const element = native.current;
    if (element === null || element.value === iso) return;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(element, iso);
    shown.current = iso;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const selected = isoToDate(native.current?.value || undefined);
  const disabledDays = [
    ...(min ? [{ before: isoToDate(String(min))! }] : []),
    ...(max ? [{ after: isoToDate(String(max))! }] : []),
  ].filter((rule) => Object.values(rule)[0] !== undefined);

  return (
    <div className={cn("flex items-center gap-2", WIDTH_CLASS[width])}>
      <input
        {...props}
        type="date"
        id={id === undefined ? undefined : `${id}-native`}
        min={min}
        max={max}
        disabled={disabled}
        ref={(element) => {
          native.current = element;
          if (typeof ref === "function") ref(element);
          else if (ref) ref.current = element;
        }}
        onChange={(event) => {
          shown.current = event.target.value;
          setText(isoToText(event.target.value));
          onChange?.(event);
        }}
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
      />
      <Input
        ref={visible}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={t("form.datePlaceholder")}
        value={text}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [getDescribedBy(id, error, hint), describedBy]
            .filter(Boolean)
            .join(" ") || undefined
        }
        className={cn("min-h-touch min-w-0 flex-1 tabular-nums", className)}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next.trim() === "") write("");
          else {
            const iso = textToIso(next);
            if (iso !== null) write(iso);
          }
        }}
        onBlur={() => {
          // Недонабранная или несуществующая дата не остаётся прежним
          // значением под новым текстом: поле пустеет, и проверка формы
          // говорит об ошибке у поля.
          if (text.trim() !== "" && textToIso(text) === null) write("");
          native.current?.dispatchEvent(
            new Event("focusout", { bubbles: true }),
          );
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            className="min-h-touch min-w-touch shrink-0"
            aria-label={t("form.pickDate")}
          >
            <CalendarDays aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <DateCalendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            disabled={disabledDays}
            onSelect={(date) => {
              if (date === undefined) return;
              const iso = dateToIso(date);
              write(iso);
              setText(isoToText(iso));
              setOpen(false);
              visible.current?.focus();
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export const PasswordField = Field;

/** Пустое значение `<option value="">` — у пункта списка кита оно запрещено. */
const EMPTY = "__empty__";

interface Choice {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

/** Варианты берутся из `<option>`, как у системного списка: вызовы не меняются. */
function choicesOf(children: ReactNode): Choice[] {
  const out: Choice[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<ComponentProps<"option">>(child)) return;
    if (child.type === Fragment) {
      out.push(
        ...choicesOf((child.props as { children?: ReactNode }).children),
      );
      return;
    }
    if (child.type !== "option") return;
    out.push({
      value: String(child.props.value ?? ""),
      label: child.props.children,
      disabled: child.props.disabled === true,
    });
  });
  return out;
}

/**
 * Оформленный список без подписи — для места, где подпись стоит рядом, а не
 * над полем (переключатель ребёнка в шапке). В форме — `SelectField`.
 *
 * Выбор из списка — оформленный список кита (docs/PLAN_UI_ORDER_2026-11.md,
 * этап 2): та же высота, рамка и фокус, что у поля ввода, и своё меню вместо
 * системного.
 *
 * Значение живёт в скрытом системном `<select>`: его регистрирует
 * react-hook-form (`register()`, `valueAsNumber`), он же получает событие
 * `change` при выборе. Так устроен и сам Radix Select. Вызовы поля не меняются:
 * варианты по-прежнему передаются `<option>`.
 *
 * Подпись, пояснение и ошибка связаны с кнопкой списка — её фокусирует сводка
 * ошибок формы и её объявляет программа чтения с экрана.
 */
export function KitSelect({
  error,
  hint,
  id,
  className,
  width = "full",
  children,
  ref,
  onChange,
  "aria-describedby": describedBy,
  ...props
}: Pick<FieldBaseProps, "error" | "hint" | "width"> &
  ComponentProps<"select">) {
  const native = useRef<HTMLSelectElement | null>(null);
  const choices = choicesOf(children);
  const controlled = props.value !== undefined;
  const [current, setCurrent] = useState<string>(() =>
    String(props.value ?? props.defaultValue ?? ""),
  );

  // Значение могли записать в обход события — `reset()` и значения по
  // умолчанию react-hook-form ставит прямо в элемент. Сверка после каждой
  // отрисовки дешёвая и не даёт кнопке показать устаревший выбор.
  // Без списка зависимостей намеренно: запись в обход события не меняет ни
  // одного пропа. Цикла нет — состояние меняется, только пока оно расходится
  // с элементом, и после одной записи совпадает.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const value = native.current?.value;
    if (value !== undefined && value !== current) setCurrent(value);
  });

  const shown = controlled ? String(props.value) : current;

  function choose(next: string) {
    const element = native.current;
    // Пустую строку Radix присылает сам, когда его внутренний скрытый список
    // ещё не знает выбранного варианта (меню закрыто, пункты не отрисованы).
    // Это не выбор человека: пустой вариант у нас приходит как `EMPTY`, и
    // принять "" значило бы молча стереть значение формы — так терялось
    // кетосоотношение назначения.
    if (next === "") return;
    const value = next === EMPTY ? "" : next;
    if (element === null || value === element.value) return;
    // Сеттер прототипа, а не `element.value =`: React следит за значением
    // управляемого элемента и иначе проглотил бы событие.
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    setCurrent(value);
  }

  const placeholder = choices.find((c) => c.value === "")?.label;

  return (
    <>
      <select
        {...props}
        id={id === undefined ? undefined : `${id}-native`}
        ref={(element) => {
          native.current = element;
          if (typeof ref === "function") ref(element);
          else if (ref) ref.current = element;
        }}
        onChange={(event) => {
          setCurrent(event.target.value);
          onChange?.(event);
        }}
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
      >
        {children}
      </select>
      <Select
        value={shown === "" ? EMPTY : shown}
        onValueChange={choose}
        disabled={props.disabled}
      >
        <SelectTrigger
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [getDescribedBy(id, error, hint), describedBy]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className={cn(
            FIELD_CONTROL,
            "h-auto justify-between text-base shadow-none",
            WIDTH_CLASS[width],
            className,
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem
              key={choice.value === "" ? EMPTY : choice.value}
              value={choice.value === "" ? EMPTY : choice.value}
              disabled={choice.disabled}
            >
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

/**
 * Выбор из списка — оформленный список кита (docs/PLAN_UI_ORDER_2026-11.md,
 * этап 2): та же высота, рамка и фокус, что у поля ввода, и своё меню вместо
 * системного.
 *
 * Значение живёт в скрытом системном `<select>`: его регистрирует
 * react-hook-form (`register()`, `valueAsNumber`), он же получает событие
 * `change` при выборе. Так устроен и сам Radix Select. Вызовы поля не меняются:
 * варианты по-прежнему передаются `<option>`.
 *
 * Подпись, пояснение и ошибка связаны с кнопкой списка — её фокусирует сводка
 * ошибок формы и её объявляет программа чтения с экрана.
 */
export function SelectField({
  label,
  error,
  hint,
  optional,
  id,
  ...props
}: FieldBaseProps & ComponentProps<"select">) {
  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      optional={optional}
      id={id}
    >
      <KitSelect id={id} error={error} hint={hint} {...props} />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  optional,
  id,
  className,
  width = "full",
  ...props
}: FieldBaseProps & ComponentProps<"textarea">) {
  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      optional={optional}
      id={id}
    >
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={getDescribedBy(id, error, hint)}
        className={cn(WIDTH_CLASS[width], className)}
        {...props}
      />
    </FieldShell>
  );
}

/**
 * Выбор файла.
 *
 * Родной `<input type="file">` остаётся — он и только он даёт клавиатуру,
 * скринридер и системный диалог. Но его кнопку браузер подписывает сам и
 * по-английски («Choose File»), а атрибутами это не меняется: правило 8
 * требует русского текста через i18n, и подпись рисуем мы.
 *
 * Поэтому поле визуально скрыто, но остаётся в потоке фокуса (`sr-only`, а не
 * `display: none` — скрытый так элемент выпадает из табуляции), а видимую
 * кнопку изображает связанный с ним `<label>`. Кольцо фокуса переносится на
 * label через `focus-within`, иначе фокус становится невидим.
 */
export function FileField({
  label,
  error,
  hint,
  optional,
  id,
  className,
  width = "full",
  ...props
}: FieldBaseProps & ComponentProps<"input">) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      optional={optional}
      id={id}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-field",
          WIDTH_CLASS[width],
          className,
        )}
      >
        <input
          id={id}
          type="file"
          // `peer` — потому что поле стоит перед label в DOM: подсветить
          // соседа можно только вперёд.
          className="peer sr-only"
          aria-invalid={error ? true : undefined}
          aria-describedby={getDescribedBy(id, error, hint)}
          {...props}
          onChange={(event) => {
            setChosen(event.target.files?.[0]?.name ?? null);
            props.onChange?.(event);
          }}
        />

        {/* `htmlFor` вместо кнопки с ref: клик по label открывает системный
            диалог сам, без обработчика, — и делает это в том числе с
            клавиатуры, потому что фокус стоит на самом поле. */}
        <label
          htmlFor={id}
          className={cn(
            "inline-flex min-h-touch cursor-pointer items-center rounded-md border border-input",
            "bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground",
            "hover:bg-secondary/80",
            // Кольцо фокуса переносится на label: само поле скрыто, и без
            // этого фокус на нём не виден вовсе. Прежний селектор смотрел на
            // следующего соседа label — то есть на подпись с именем файла, а
            // не на поле, и не срабатывал никогда.
            //
            // Оформление — как у кнопок кита (`button.tsx`), чтобы фокус
            // выглядел одинаково во всём приложении.
            "peer-focus-visible:outline peer-focus-visible:outline-2",
            "peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
          )}
        >
          {t("actions.chooseFile")}
        </label>

        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {chosen ?? t("actions.noFileChosen")}
        </span>
      </div>
    </FieldShell>
  );
}
