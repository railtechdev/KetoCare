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
- Только токены темы (CSS-переменные), значения из ТЗ §11: фон #FAF7F2, поверхность #FFFFFF,
  акцент #2E5E4E, текст #2B2B2B, danger #B4483E, warning #C98A2B, success #3E7C4F.
  Радиус 12 px, шрифт Inter. Хардкод цветов в компонентах — ошибка ревью.
- Обязательные готовые компоненты: RatioBadge, MacroBar, TrendChart (с маркерами
  смены назначения), DiaryEntryCard, WarningBanner, DataTable.
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
