import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Columns,
  ConfirmDialog,
  DensityProvider,
  DiaryEntryCard,
  EmptyState,
  ErrorState,
  Fact,
  FactList,
  FilterBar,
  FormFooter,
  MacroBar,
  MacroFacts,
  Metric,
  MetricRow,
  RatioBadge,
  Section,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tiles,
  toast,
  WarningBanner,
} from "@ketocare/ui";
import { Inbox } from "lucide-react";

import { Field, SelectField, TextAreaField } from "../components/Field";
import { PageLayout } from "../components/PageLayout";

/**
 * Витрина дизайн-системы (раздел 15, п. 8 ТЗ).
 *
 * Нужна не для красоты: расхождения между компонентами видно только рядом.
 * Именно так были замечены две высоты кнопок и пропавшая полоса у баннера
 * опасности. Доступна только в dev-сборке — маршрут не регистрируется в
 * production (см. router.tsx).
 *
 * Строки здесь намеренно не через i18n: это инструмент разработчика, а не
 * пользовательский экран.
 */
export function UiShowcase() {
  return (
    <PageLayout
      title="Витрина компонентов"
      intro="Все общие компоненты рядом — чтобы расхождения были видны глазами."
    >
      <Section title="Кнопки">
        <div className="flex flex-wrap items-center gap-block">
          <Button>Основная</Button>
          <Button variant="secondary">Вторичная</Button>
          <Button variant="outline">Контурная</Button>
          <Button variant="ghost">Прозрачная</Button>
          <Button variant="destructive">Опасная</Button>
          <Button disabled>Заблокирована</Button>
          <Button size="sm">Мелкая</Button>
          <Button size="lg">Крупная</Button>
        </div>
      </Section>

      <Section title="Поля формы">
        <div className="max-w-form">
          <Field id="demo-text" label="Строка" hint="Пояснение под полем" />
          <Field
            id="demo-number"
            label="Число"
            type="number"
            inputMode="decimal"
            optional
          />
          <Field
            id="demo-error"
            label="С ошибкой"
            error="Значение вне допустимого диапазона"
          />
          <SelectField id="demo-select" label="Список">
            <option>Первый</option>
            <option>Второй</option>
          </SelectField>
          <TextAreaField id="demo-textarea" label="Многострочное" rows={3} />
          <FormFooter
            submitLabel="Сохранить"
            pendingLabel="Сохраняем…"
            cancelLabel="Отмена"
            onCancel={() => undefined}
          />

          {/* Тот же подвал, но отправить нечем: правило П44 — отключённая
              кнопка называет причину. Рядом с обычным видно, что причина не
              ошибка, а подпись. */}
          <FormFooter
            submitLabel="Сохранить"
            pendingLabel="Сохраняем…"
            disabled
            reason="Блюдо не названо — под этим именем оно появится в списке."
          />
        </div>
      </Section>

      <Section title="Предметные компоненты">
        <div className="flex flex-wrap items-center gap-block">
          <RatioBadge ratio={3.9} />
          <RatioBadge ratio={4.2} withinTolerance={false} />
          <RatioBadge ratio={3.5} withinTolerance />
          <Badge>Метка</Badge>
          <Badge variant="secondary">Вторичная</Badge>
        </div>
        <MacroBar
          className="mt-4 max-w-md"
          fatG={80}
          proteinG={20}
          carbsG={8}
        />
        {/* Рядом с полосой намеренно: те же числа в двух формах. Полоса
            отвечает «каково соотношение», числа — «что даёт этот продукт», и
            расхождение их размеров видно только здесь. */}
        <MacroFacts
          className="mt-4 max-w-md"
          label="Вклад продукта «Масло сливочное» в блюдо"
          kcal={367}
          fatG={40.5}
          proteinG={0.5}
          carbsG={0.1}
        />
        <DiaryEntryCard
          className="mt-4 max-w-md"
          title="3.4 ммоль/л"
          occurredAt={new Date()}
          source="web"
        >
          Замер по крови
        </DiaryEntryCard>
      </Section>

      <Section title="Сообщения">
        <div className="flex flex-col gap-block">
          <WarningBanner level="info" title="Информация">
            Нейтральное сообщение.
          </WarningBanner>
          <WarningBanner level="warning" title="Предупреждение">
            День расходится с назначением.
          </WarningBanner>
          <WarningBanner level="danger" title="Опасность">
            Расчёт неразрешим — у этой полосы должен быть красный цвет.
          </WarningBanner>
          <Button onClick={() => toast.success("Действие выполнено")}>
            Показать тост
          </Button>
        </div>
      </Section>

      <Section title="Состояния">
        <Tiles>
          <EmptyState
            icon={Inbox}
            title="Записей пока нет"
            description="Здесь появятся замеры, когда вы их добавите."
            action={<Button size="sm">Добавить запись</Button>}
          />
          <ErrorState
            title="Не удалось загрузить данные"
            description="Проверьте соединение и попробуйте ещё раз."
            retryLabel="Повторить"
            onRetry={() => undefined}
          />
          <div className="flex flex-col gap-field">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-24 w-full" />
          </div>
          <ConfirmDialog
            trigger={<Button variant="destructive">Удалить запись</Button>}
            title="Удалить запись за 27.08?"
            description="Запись исчезнет из дневника и из отчётов."
            confirmLabel="Удалить"
            cancelLabel="Отмена"
            onConfirm={() => toast.success("Удалено")}
          />
        </Tiles>
      </Section>

      {/* Примитивы раскладки — рядом, потому что выбор между ними неочевиден
          и различается только на глаз: `MetricRow` отвечает «сколько»,
          `FactList` — «какой», `columns="fit"` растягивает плитки, `"fill"`
          держит их ширину. Ширину блока здесь стоит менять окном браузера:
          все четыре реагируют на ширину САМОГО блока, а не окна. */}
      <Section title="Раскладка: «сколько» и «какой»">
        <Columns
          asideLabel="Пример приставной колонки"
          main={
            <>
              <MetricRow label="MetricRow — «сколько»">
                <Metric label="Кетосоотношение" value="3.5 : 1" />
                <Metric label="Калорийность" value="1200" unit="ккал" />
                <Metric label="Белок" value="25" unit="г" />
                <Metric label="Рост" value={null} />
              </MetricRow>

              <FactList label="FactList — «какой»">
                <Fact label="Дата рождения" value="12.04.2019 (7 лет)" />
                <Fact label="Пол" value="девочка" />
                <Fact label="Аллергии" value={null} />
                <Fact
                  label="Заметки семьи"
                  value={"Две строки текста,\nвторая строка."}
                  multiline
                />
              </FactList>
            </>
          }
          aside={
            <MetricRow label="Тот же ряд в колонке 20rem">
              <Metric label="Кетосоотношение" value="3.5 : 1" />
              <Metric label="Калорийность" value="1200" unit="ккал" />
            </MetricRow>
          }
        />
      </Section>

      <Section title="Раскладка: плитки и отбор">
        <FilterBar
          label="Пример панели отбора"
          action={<Button variant="outline">Сбросить</Button>}
        >
          <Field id="showcase-filter-q" label="Поиск" width="wide" />
          <SelectField id="showcase-filter-kind" label="Вид" width="medium">
            <option>Любой</option>
          </SelectField>
        </FilterBar>

        <p className="m-0 text-sm text-muted-foreground">
          columns=&quot;fit&quot; — плитки растягиваются и заполняют строку:
        </p>
        <Tiles min="sm" columns="fit">
          <Card>
            <CardContent>Одна</CardContent>
          </Card>
        </Tiles>

        <p className="m-0 text-sm text-muted-foreground">
          columns=&quot;fill&quot; — плитка держит ширину, лишние столбцы
          пустые:
        </p>
        <Tiles min="sm" columns="fill">
          <Card>
            <CardContent>Одна</CardContent>
          </Card>
        </Tiles>
      </Section>

      <Section title="Плотность экрана">
        <p className="m-0 text-sm text-muted-foreground">
          Задаётся один раз на экране (`PageLayout density`) и наследуется
          блоками. Слева — семья, справа — специалист.
        </p>
        <Tiles min="sm">
          <DensityProvider density="comfortable">
            <Section title="comfortable" level={3}>
              Экран семьи: одно дело на страницу.
            </Section>
          </DensityProvider>
          <DensityProvider density="compact">
            <Section title="compact" level={3}>
              Экран специалиста: повторяющиеся операции.
            </Section>
          </DensityProvider>
        </Tiles>
      </Section>

      <Section title="Карточки и вкладки">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">Первая</TabsTrigger>
            <TabsTrigger value="two">Вторая</TabsTrigger>
          </TabsList>
          <TabsContent value="one">
            <Card>
              <CardHeader>
                <CardTitle>Заголовок карточки</CardTitle>
                <CardDescription>Пояснение под заголовком</CardDescription>
              </CardHeader>
              <CardContent>Содержимое карточки.</CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="two">Содержимое второй вкладки.</TabsContent>
        </Tabs>
      </Section>
    </PageLayout>
  );
}
