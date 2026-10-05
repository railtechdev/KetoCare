---
name: frontend-feature
description: Разработка UI в apps/web (SPA) и apps/miniapp — экраны, компоненты, формы, графики, TanStack Query/Router/Table, дизайн-система packages/ui, i18n. Использовать при любой фронтенд-задаче.
---

# Фронтенд — конвенции

## Данные

- Только `packages/api-client` (генерированный). Ручных fetch/axios нет.
- TanStack Query: ключи иерархией `['patient', id, 'menu', date]`;
  мутация инвалидирует затронутые ключи. Оптимистичные апдейты — только чекбоксы `eaten`.
- Формы: react-hook-form + zod-схема; сообщения валидации — через i18n.

## UI

- Компоненты — из `packages/ui`; новый общий компонент клади туда, не в apps/web.
- Стилизация — Tailwind 4 + shadcn/ui. Тема задана в `packages/ui/src/styles/tokens.css`
  блоком `@theme`: значения оттуда становятся и CSS-переменными, и утилитами
  (`--color-primary` → `bg-primary`/`text-primary`). Словарь — как у кита shadcn/ui:
  `background`, `foreground`, `card`, `primary`, `secondary`, `muted`,
  `muted-foreground`, `accent`, `destructive`, `border`, `input`, `ring`; сверх него
  наши `warning`, `success` и `--spacing-touch`. Значения — только в `tokens.css`;
  выбывшие имена (`canvas`, `surface`, `ink`, `line`, `danger`, `on-accent`)
  ловит `tokens.test.ts`.
- Пользуйся утилитами темы (`bg-card`, `text-foreground`, `text-muted-foreground`,
  `border-border`), не литеральными цветами: Mini App перекрашивает
  интерфейс, подставляя themeParams Telegram в те же переменные. Хардкод цвета в
  компоненте — ошибка ревью.
- Шкалы, а не глазомер: `text-page-title` / `text-section-title` / `text-card-title`,
  `gap-screen` / `gap-block` / `gap-field`; ширина страницы — роль `PageLayout width`,
  колонки — примитивы кита (`Columns`, `Tiles`, `MetricRow`, `FactList`, `SplitView`,
  `Workspace`). Подробно — `docs/UI_GUIDE.md` и раздел «UI-канон» в `CLAUDE.md`.
- Текст на цветной подложке бери из парного токена (`text-primary-foreground`,
  `text-on-warning`, `text-on-success`), а не «белый по умолчанию»: на warning белый
  даёт контраст ниже требуемых 4.5. Контраст обеих тем проверяет
  `packages/ui/src/styles/contrast.test.ts`.
- Общие предметные компоненты кита: RatioBadge, MacroBar, MacroFacts, TargetBar,
  WarningBanner, DiaryEntryCard, TrendChart, DataTable, ChatMessage/ChatComposer;
  состояния — AsyncSection, EmptyState, ErrorState, ConfirmDialog, FormSheet. Прежде
  чем писать своё — список «Общие места `apps/web`» в `CLAUDE.md`.
- `RatioBadge` принимает вердикт о допуске от сервера (`ratio_within_tolerance`),
  а НЕ считает его сам: `RATIO_TOLERANCE` — медицинская константа ядра, её копия
  в TypeScript со временем разойдётся, и интерфейс покажет «в норме» там, где ядро
  считает иначе.
- Родительский интерфейс: тач-цели ≥ 44px, ≤ 3 поля на экран формы.
- Доступность: focus-visible, aria-метки, контраст ≥ 4.5:1.

## i18n

Все строки — `react-i18next`, файлы `src/locales/ru/*.json`, ключи по разделам
(`calculator.solve.infeasible`). Строка в JSX-литерале = ошибка.

Mini App — на двух языках (ADR-0052): новый ключ кладётся и в
`apps/miniapp/src/locales/ru/app.json`, и в `uz/app.json` (латиница), с теми
же `{{переменными}}`; паритет держит `locales/locales.test.ts`. Даты с
названием месяца — `Intl.DateTimeFormat(formatLocale(), …)` из кита, не
`"ru-RU"`. Кабинет (`apps/web`) — только русский.

## Роли и роутинг

TanStack Router; guard по роли из JWT. Раздел недоступной роли не рендерится
И защищён guard'ом. Помни: фронтовые проверки — это UX, безопасность обеспечивает
сервер. Врачебное/админское в miniapp не попадает никогда.

## Miniapp-специфика

Роутера и cookie нет: экран один, токены в памяти вкладки, заголовком. Всё
знание о Telegram — в `apps/miniapp/src/lib/{telegram,theme}.ts`; вне Telegram
приложение тоже открывается. themeParams → CSS-переменные (тёмная тема
обязательна); safe-area. Вход — только по подписи запуска → POST
/auth/telegram-init; подпись читается из адреса (`tgWebAppData`), SDK
`@telegram-apps/sdk-react` и `window.Telegram.WebApp` — запасные. Сессия сужена до
одного ребёнка. То, что обязано совпадать с кабинетом (проверка записи дневника,
цель приёма, вердикт дня), живёт в ките, а не копируется.
