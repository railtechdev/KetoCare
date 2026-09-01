import {
  AsyncSection,
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  toast,
} from "@ketocare/ui";
import {
  Baby,
  ClipboardList,
  MessageCircle,
  Paperclip,
  Plus,
  Stethoscope,
} from "lucide-react";
import { useSectionItem, useSectionTab } from "../../routes/useSectionTab";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { AttachmentsPanel } from "../attachments/AttachmentsPanel";
import { CareTeamPanel } from "../doctor/CareTeamPanel";
import { errorMessageOf } from "../../lib/api";
import { IntakeForm } from "../intake/IntakeForm";
import { RemindersPanel } from "../telegram/RemindersPanel";
import { TelegramPanel } from "../telegram/TelegramPanel";
import { ChildForm } from "./ChildForm";
import { toChildBody, toChildUpdateBody } from "./childSchemas";
import {
  useCreateChildMutation,
  useUpdateChildMutation,
  type Patient,
} from "../patients/useChildren";
import { allergyNames } from "../patients/allergies";
import { usePatients } from "../patients/usePatients";

/**
 * Подэкраны раздела. Живут в адресе, а не в состоянии (правило П30 канона).
 *
 * До этого «Анкета», «Документы», «Telegram» и «Кто ведёт» открывались
 * состоянием: адрес оставался `/app/child`, «Назад» браузера уводил из раздела
 * вовсе, а F5 терял открытый экран — прямо посреди заполнения анкеты. Ссылку на
 * анкету нельзя было ни переслать, ни сохранить.
 */
const TABS = [
  "list",
  "add",
  "edit",
  "intake",
  "documents",
  "telegram",
  "care",
] as const;

type Tab = (typeof TABS)[number];

/**
 * Раздел «Ребёнок»: профили детей семьи.
 *
 * Раньше это лежало в разделе «Настройки» — и заказчик на первом же показе
 * спросил, чья это страница, ребёнка или родителя. Вопрос справедливый: ребёнок
 * — главный предмет всего кабинета родителя, а «Настройки» не говорят ни о чём.
 * Свой профиль родителя живёт отдельно, в меню пользователя (ADR-0006).
 */
export function ChildPage() {
  const { t } = useTranslation("child");
  const patients = usePatients();
  const [tab, setTab] = useSectionTab<Tab>("tab", TABS, "list");
  const [openId, setOpenId] = useSectionItem();

  const children = patients.data?.items ?? [];
  const child = children.find((item) => item.id === openId) ?? null;

  function backToList() {
    setOpenId(undefined);
    setTab("list");
  }

  function open(next: Tab, forChild: Patient) {
    setOpenId(forChild.id);
    setTab(next);
  }

  if (tab === "add") return <AddChild onDone={backToList} />;

  // Подэкран без ребёнка (устаревшая ссылка, ребёнка уже удалили) — это список,
  // а не пустой экран: адрес ведёт в раздел, а раздел существует.
  if (tab !== "list" && child !== null) {
    if (tab === "edit") return <EditChild child={child} onDone={backToList} />;
    if (tab === "documents")
      return <ChildDocuments child={child} onDone={backToList} />;
    if (tab === "telegram")
      return <ChildTelegram child={child} onDone={backToList} />;
    if (tab === "care") return <ChildCare child={child} onDone={backToList} />;
    if (tab === "intake")
      return <ChildIntake child={child} onDone={backToList} />;
  }

  return (
    <PageLayout
      title={t("title")}
      intro={t("children.intro")}
      actions={
        <Button type="button" onClick={() => setTab("add")}>
          <Plus aria-hidden="true" />
          {t("child.add")}
        </Button>
      }
    >
      {/* Четыре состояния — в AsyncSection: там же записано, почему упавшее
          обновление не должно прятать уже показанный список детей. */}
      <AsyncSection
        loading={patients.isLoading}
        skeleton={
          <div
            className="flex flex-col gap-block"
            role="status"
            aria-busy="true"
          >
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        }
        error={
          patients.isError
            ? {
                title: t("children.loadError"),
                description:
                  errorMessageOf(patients.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void patients.refetch()}
        isEmpty={children.length === 0}
        empty={
          <EmptyState
            icon={Baby}
            title={t("children.empty")}
            description={t("children.emptyHint")}
            action={
              <Button type="button" onClick={() => setTab("add")}>
                <Plus aria-hidden="true" />
                {t("child.add")}
              </Button>
            }
          />
        }
      >
        <ul className="m-0 flex list-none flex-col gap-block p-0">
          {children.map((child) => (
            <li key={child.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-block">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-semibold">{child.full_name}</span>
                    <span className="text-sm text-muted-foreground">
                      {t("children.birthDate", { date: child.birth_date })}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {child.height_cm === null
                        ? t("children.noHeight")
                        : t("children.height", { value: child.height_cm })}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {/* Названия, а не идентификаторы: поле хранит ссылки на
                          продукты вперемешку со свободными метками, и «3f2a…»
                          в карточке не читается никем. */}
                      {child.allergies.length === 0
                        ? t("children.noAllergies")
                        : t("children.allergies", {
                            list: allergyNames(
                              child,
                              t("children.unknownProduct"),
                            ).join(", "),
                          })}
                    </span>
                  </div>

                  <div className="ml-auto flex flex-wrap gap-field">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-touch"
                      onClick={() => open("intake", child)}
                    >
                      <ClipboardList aria-hidden="true" />
                      {t("children.intake")}
                    </Button>
                    {/* Документы приносит из стационара семья: выписку, ЭЭГ,
                        анализы. До этого приложить их могли только врач и
                        диетолог — ради семьи подсистема и делалась
                        (ADR-0004). */}
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-touch"
                      onClick={() => open("documents", child)}
                    >
                      <Paperclip aria-hidden="true" />
                      {t("children.documents")}
                    </Button>
                    {/* Бот — канал семьи (раздел 7 ТЗ). Кнопка стоит здесь,
                        потому что привязка относится к ребёнку, а не к
                        родителю: у одной семьи может быть двое детей и два
                        разных чата. */}
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-touch"
                      onClick={() => open("telegram", child)}
                    >
                      <MessageCircle aria-hidden="true" />
                      {t("children.telegram")}
                    </Button>
                    {/* Ручка `GET /patients/{id}/doctors` родителю прямо
                        разрешена — «родитель вправе знать, кто имеет доступ к
                        данным ребёнка», — а экрана у неё не было ни одного.
                        Семья не знала ни имени врача, ни того, что к карте
                        подключён диетолог. */}
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-touch"
                      onClick={() => open("care", child)}
                    >
                      <Stethoscope aria-hidden="true" />
                      {t("children.care")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-touch"
                      onClick={() => open("edit", child)}
                    >
                      {t("children.edit")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </AsyncSection>
    </PageLayout>
  );
}

function AddChild({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("child");
  const create = useCreateChildMutation();

  return (
    <PageLayout title={t("child.addTitle")} width="form" onBack={onDone}>
      <ChildForm
        child={null}
        pending={create.isPending}
        error={create.error}
        onCancel={onDone}
        onSubmit={(values) => {
          create.mutate(toChildBody(values), {
            onSuccess: (child) => {
              toast.success(t("child.added", { name: child.full_name }));
              onDone();
            },
          });
        }}
      />
    </PageLayout>
  );
}

function EditChild({ child, onDone }: { child: Patient; onDone: () => void }) {
  const { t } = useTranslation("child");
  const update = useUpdateChildMutation(child.id);

  return (
    <PageLayout title={t("child.editTitle")} width="form" onBack={onDone}>
      <ChildForm
        child={child}
        pending={update.isPending}
        error={update.error}
        onCancel={onDone}
        onSubmit={(values) => {
          update.mutate(toChildUpdateBody(values), {
            onSuccess: (saved) => {
              toast.success(t("child.saved", { name: saved.full_name }));
              onDone();
            },
          });
        }}
      />
    </PageLayout>
  );
}

/**
 * Анкета регистрации ребёнка (ADR-0007).
 *
 * Отдельным экраном, а не панелью: правило П29 канона оставляет панель коротким
 * формам, а здесь три шага вопросов. Возврат — через шаблон (правило П2).
 */
function ChildIntake({
  child,
  onDone,
}: {
  child: Patient;
  onDone: () => void;
}) {
  const { t } = useTranslation("intake");

  return (
    <PageLayout
      title={t("titleFor", { name: child.full_name })}
      intro={t("intro")}
      width="form"
      onBack={onDone}
    >
      <IntakeForm
        patientId={child.id}
        childName={child.full_name}
        onDone={onDone}
      />
    </PageLayout>
  );
}

/**
 * Документы ребёнка глазами семьи.
 *
 * Возврат — через шапку шаблона (правило П2 канона), как у анкеты: это шаг в
 * глубину раздела, а не отдельный раздел меню.
 */
function ChildDocuments({
  child,
  onDone,
}: {
  child: Patient;
  onDone: () => void;
}) {
  const { t } = useTranslation("child");

  return (
    <PageLayout
      title={t("documents.title", { name: child.full_name })}
      intro={t("documents.intro")}
      onBack={onDone}
    >
      <AttachmentsPanel patientId={child.id} />
    </PageLayout>
  );
}

/**
 * Подключение Telegram-бота для конкретного ребёнка.
 *
 * Отдельным экраном, а не панелью в карточке: код привязки живёт 15 минут и
 * показывается один раз, а список чатов — это про доступ к клиническим данным.
 * И то и другое требует внимания, а не беглого взгляда в списке детей.
 */
function ChildTelegram({
  child,
  onDone,
}: {
  child: Patient;
  onDone: () => void;
}) {
  const { t } = useTranslation("telegram");

  return (
    <PageLayout title={t("title")} intro={t("intro")} onBack={onDone}>
      <TelegramPanel patientId={child.id} childName={child.full_name} />

      {/* Напоминания — там же, где привязка: без чата им некуда приходить,
          и настраивать их до привязки значит обещать несуществующее. */}
      <RemindersPanel patientId={child.id} />
    </PageLayout>
  );
}

/**
 * Кто ведёт ребёнка — глазами семьи.
 *
 * Тот же `CareTeamPanel`, что у специалиста: у родителя `canWrite` ложен, и
 * панель остаётся списком без кнопок. Своя копия «только для чтения» разошлась
 * бы с оригиналом на первой же правке — а расходится в таком месте состав
 * людей, имеющих доступ к данным ребёнка.
 */
function ChildCare({ child, onDone }: { child: Patient; onDone: () => void }) {
  const { t } = useTranslation("child");

  return (
    <PageLayout
      title={t("care.title", { name: child.full_name })}
      onBack={onDone}
    >
      <CareTeamPanel
        patientId={child.id}
        title={t("care.section")}
        description={t("care.intro")}
      />
    </PageLayout>
  );
}
