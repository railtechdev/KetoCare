import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DiaryEntryCard,
  EmptyState,
  ErrorState,
  FormFooter,
  MacroBar,
  RatioBadge,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  WarningBanner,
  toast,
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
        <div className="grid gap-block lg:grid-cols-2">
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
        </div>
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-block">
      <h2 className="m-0 text-section-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}
