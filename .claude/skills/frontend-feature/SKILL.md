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
- Стилизация — Tailwind 4 (ТЗ §3). Тема задана в `packages/ui/src/styles/tokens.css`
  блоком `@theme`: значения оттуда становятся и CSS-переменными, и утилитами
  (`--color-accent` → `bg-accent`/`text-accent`). Палитра из ТЗ §8.2: фон #FAF7F2,
  поверхность #FFFFFF, акцент #2E5E4E, текст #2B2B2B, danger #B4483E, warning #C98A2B,
  success #3E7C4F; радиус 12 px, шрифт Inter.
- Пользуйся утилитами темы (`bg-surface`, `text-ink`, `rounded-kc`), не литеральными
  цветами: Mini App перекрашивает интерфейс, подставляя themeParams Telegram в те же
  переменные. Хардкод цвета в компоненте — ошибка ревью.
- Текст на цветной подложке бери из парного токена (`text-on-accent`, `text-on-warning`),
  а не «белый по умолчанию»: на warning белый даёт контраст 2.9 при требуемых 4.5.
  Контраст обеих тем проверяет `packages/ui/src/styles/contrast.test.ts`.
- Обязательные общие компоненты (ТЗ §8.2): RatioBadge, MacroBar, WarningBanner,
  DiaryEntryCard — готовы; TrendChart (с маркерами смены назначения) и DataTable
  добавляются вместе с экранами, которые их используют (recharts и
  @tanstack/react-table уже установлены).
- `RatioBadge` принимает вердикт о допуске от сервера (`ratio_within_tolerance`),
  а НЕ считает его сам: `RATIO_TOLERANCE` — медицинская константа ядра, её копия
  в TypeScript со временем разойдётся, и интерфейс покажет «в норме» там, где ядро
  считает иначе.
- Родительский интерфейс: тач-цели ≥ 44px, ≤ 3 поля на экран формы.
- Доступность: focus-visible, aria-метки, контраст ≥ 4.5:1.

## i18n

Все строки — `react-i18next`, файлы `src/locales/ru/*.json`, ключи по разделам
(`calculator.solve.infeasible`). Строка в JSX-литерале = ошибка.

## Роли и роутинг

TanStack Router; guard по роли из JWT. Раздел недоступной роли не рендерится
И защищён guard'ом. Помни: фронтовые проверки — это UX, безопасность обеспечивает
сервер. Врачебное/админское в miniapp не попадает никогда.

## Miniapp-специфика

@telegram-apps/sdk-react; themeParams → CSS-переменные (тёмная тема обязательна);
safe-area; auth только через initData → POST /auth/telegram-init.
