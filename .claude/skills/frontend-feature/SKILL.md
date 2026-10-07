---
name: frontend-feature
description: Разработка UI в apps/web (SPA) и apps/miniapp — экраны, компоненты, формы, графики, TanStack Query/Router/Table, дизайн-система packages/ui, i18n. Использовать при любой фронтенд-задаче.
---

# Фронтенд — конвенции

Правила интерфейса — `docs/UI_GUIDE.md` (канон, правила П1–П45, чек-лист в конце);
общие места кабинета — раздел «Общие места `apps/web`» в `CLAUDE.md`. Большая часть
правил ниже держится тестами-сторожами: упал сторож — чини экран, а не сторож.

## Данные

- Только `packages/api-client` (генерированный). Ручных fetch/axios нет.
- TanStack Query: ключ начинается с предмета (`["patient", id, …]`,
  `["products", "list", query]`); мутация инвалидирует затронутые ключи.
  Оптимистичное обновление — только отметка «съедено» (`features/menu/useMenu.ts`).
- **Каждый `AsyncSection` кабинета получает `{...queryState(q)}`**
  (`apps/web/src/lib/queryState.ts`), а не `loading={q.isLoading}`: без сети
  запрос стоит на паузе, `isLoading` ложен, и блок врал «записей нет». Блок из
  нескольких запросов — `queryState(a, b)`; экран без `AsyncSection` —
  `isAwaitingData(q)`. Сторож — `apps/web/src/asyncSections.test.ts`. В Mini App
  `queryState` нет, и `waiting` передаётся явно:
  `q.fetchStatus === "paused" ? t("errors.waitingForNetwork") : null`.
- **Состояние экрана — в адресе.** Вкладка, вид, открытый объект (`?item=`),
  задача PDF (`?job=`), поиск, фильтры — параметры, объявленные и проверенные в
  `apps/web/src/routes/search.ts` (`validateSectionSearch`,
  `validatePatientSearch`). Параметр, которого там нет, роутер выбрасывает молча.
  Проверка: пропало после F5 — дефект. Вкладки — `routes/useSectionTab.ts`.
- То, что обязано совпадать у кабинета и Mini App, живёт в ките, не копируется:
  `diaryEntry` (проверка записи и тело запроса), `describeDiaryEntry` (запись
  словами), `mealTargetsFrom`, `dayVerdict`, `MacroFacts`.

## Формы

- react-hook-form + zod; сообщения валидации — через i18n.
- **Каждая форма на `useForm` рисует `<FormErrorSummary items={errorSummaryItems(submitCount, …)} />`**
  первым элементом (П8, `apps/web/src/components/FormErrorSummary.tsx`). Сторож —
  `apps/web/src/formErrorSummary.test.ts`; исключение — только записью с причиной
  в его `ALLOWED_WITHOUT_SUMMARY`.
- Поля кабинета — `components/Field.tsx` (`Field` / `SelectField` / `TextAreaField`).
  Поле без react-hook-form (Mini App) — `FieldShell` кита; системный список —
  `NativeSelect` кита (не Radix `Select`: в Telegram родное колесо выбора).
- Отключённая кнопка называет причину — `ActionReason` кита (П44).
- Форма дневника — не больше трёх полей на экран (ТЗ §8.3).

## Экран

- Шаблон — `PageLayout` (`width` = `form`/`content`/`wide`/`full`, `density`).
  Первичное действие экрана одно (П31): в слоте `actions` или из блока через
  `PageActions` (порталом в шапку). Проверка в тестах экранов —
  `primaryActions(container)` из `@ketocare/ui/testing`.
- Блок — `Section` кита (он `@container`: внутри пишутся `@sm:`, а не `sm:`).
  Колонки — только примитивы `Columns`, `Tiles`, `MetricRow`, `FactList`,
  `SplitView`, `Workspace`; `lg:/xl:/2xl:grid-cols-*` вне них ловит
  `apps/web/src/layout.test.ts`.
- Копирование в буфер — `copyText` (`apps/web/src/lib/clipboard.ts`), он
  возвращает `false` при отказе: «Скопировано» говорится только после `true`.
- Высота во весь экран — `dvh`, не `min-h-screen` (имя `screen` занято
  отступом; `apps/web/src/styles.test.ts`).

## Дизайн-система

- Компоненты — из `@ketocare/ui` (единственный вход); новый общий компонент
  кладётся в `packages/ui`. Файлы `packages/ui/src/components/ui` (shadcn) руками
  не правятся.
- Тема — `packages/ui/src/styles/tokens.css` (`@theme`): словарь кита shadcn/ui
  плюс `warning`, `warning-strong`, `success`, `on-warning`, `on-success`,
  `--spacing-touch`. Выбывшие имена ловит `tokens.test.ts`, перекрытие встроенных
  утилит Tailwind — `utilities.test.ts`.
- Только утилиты темы, не литеральные цвета: Mini App подставляет themeParams
  Telegram в те же переменные.
- **Предупреждение текстом — `text-warning-strong`.** `text-warning` как цвет
  текста запрещён (2:1 на белом) — `packages/ui/src/styles/warningText.test.ts`
  по всем трём фронтендам. `bg-warning` / `border-warning` — для подложки и полосы.
- Текст на цветной подложке — парный токен (`text-primary-foreground`,
  `text-on-warning`, `text-on-success`). Контраст обеих тем —
  `packages/ui/src/styles/contrast.test.ts`.
- Шкалы: `text-page-title` / `text-section-title` / `text-card-title`;
  отступы `gap-screen` / `gap-section` / `gap-field` (токены `--spacing-screen`,
  `--spacing-section`, `--spacing-field`; `gap-block` не существует).
- Предметные компоненты кита: `RatioBadge`, `MacroBar`, `MacroFacts`,
  `TargetBar`, `WarningBanner`, `DiaryEntryCard`, `TrendChart`, `DataTable`,
  `ChatMessage`/`ChatComposer`, `SuggestField`; состояния — `AsyncSection`,
  `EmptyState`, `ErrorState`, `ConfirmDialog`, `FormSheet`, `StatusNote`.
- **Слов кит не знает.** Подписи его предметных компонентов приходят из словаря
  приложения: `KitLabelsProvider labels={kitLabelsFrom(t)}` у корня (ключи
  `kit.*`). Новая подпись кита = поле в `KitLabels` + ключ в словарях обоих
  приложений.
- `RatioBadge` принимает вердикт сервера (`withinTolerance` ←
  `ratio_within_tolerance`), а не считает сам: `RATIO_TOLERANCE` — константа ядра.
- Числа — помощники кита (П45): `formatGrams`, `formatMass`, `formatWeight`,
  `formatKcal`, `formatRatio`, `formatDose` и др. из `packages/ui/src/lib/format.ts`.
  `toFixed` на экране и число из шаблона словаря рядом с единицей
  (`t("…", { value })`) ловят `numbers.test.ts` в кабинете, Mini App и ките
  (`rawNumbersNextToUnits` из `@ketocare/ui/testing`).
- Родительский интерфейс: тач-цели ≥ 44px. Доступность: focus-visible,
  aria-метки, контраст ≥ 4.5:1.

## i18n

Все строки — `react-i18next`. Кабинет — только русский, словари
`apps/web/src/locales/ru/<пространство>.json`, ключи по разделам. Строка в
JSX-литерале — ошибка. Неиспользуемый ключ роняет `locales/unusedKeys.test.ts`.

Mini App — два языка (ADR-0052): ключ кладётся и в `apps/miniapp/src/locales/ru/app.json`,
и в `uz/app.json` (латиница), с теми же `{{переменными}}` и формами
множественного числа; паритет держит `src/locales/locales.test.ts`. Даты с
месяцем — `Intl.DateTimeFormat(formatLocale(), …)` из кита, не `"ru-RU"`.

## Роли и роутинг (кабинет)

TanStack Router; раздел недоступной роли не рендерится и отсекается в
`beforeLoad` по `SECTIONS_BY_ROLE`. Фронтовые проверки — UX, безопасность — сервер.
Врачебное и админское в Mini App не попадает никогда.

## Mini App

- Роутера и cookie нет, токены в памяти вкладки, заголовком. Всё знание о
  Telegram — `apps/miniapp/src/lib/{telegram,theme,useTelegram}.ts`; вне Telegram
  приложение тоже открывается. Вход — подпись запуска → `POST /auth/telegram-init`;
  подпись читается из адреса (`tgWebAppData`), `@telegram-apps/sdk-react` и
  `window.Telegram.WebApp` — запасные.
- **Посещённые вкладки остаются смонтированными** (`hidden`), чтобы не терять
  набранное. Поэтому кнопка «Назад» скрытой вкладки снимается через
  `TabVisibleContext`; эффекты вкладки учитывают, что она может быть скрыта.
- **«Назад» Telegram — стопкой.** Каждое вложенное состояние (панель, карточка,
  шаг) подписывается `useTelegramBack(onBack | null)`; обработчики ложатся в
  стопку `showBackButton`, срабатывает верхний. Подтверждение — только
  `TelegramConfirmDialog`, не `ConfirmDialog` кита напрямую. Сторож —
  `apps/miniapp/src/telegramBack.test.ts` (там же список панелей, обязанных
  подписаться — новая панель вносится туда).
- Пошаговые потоки идут «Назад» по шагам, а не закрываются целиком: образец —
  `features/diary/AddEntry.tsx` (выбор вида → форма той же правки, что у записи).
- Внешняя ссылка (кабинет) — `openExternalLink` (Telegram `openLink`), пересылка
  — `shareToTelegram`; обычный `<a href>` открыл бы кабинет внутри окна Mini App.
- Тема: themeParams → токены, но цвет клиента берётся только при контрасте ≥ 4.5
  с подложкой (`lib/theme.ts`, `lib/theme.test.ts`); иначе остаётся наш токен.
  Тёмная тема и safe-area обязательны.
- Сессия сужена до одного ребёнка; детей несколько — `ChildSwitcher`, запись
  уходит выбранному (ADR-0048).
