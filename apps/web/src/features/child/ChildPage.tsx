import {
  AsyncSection,
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  toast,
} from "@ketocare/ui";
import { Baby, ClipboardList, Plus, Paperclip } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { AttachmentsPanel } from "../attachments/AttachmentsPanel";
import { errorMessageOf } from "../../lib/api";
import { IntakeForm } from "../intake/IntakeForm";
import { ChildForm } from "./ChildForm";
import { toChildBody, toChildUpdateBody } from "./childSchemas";
import {
  useCreateChildMutation,
  useUpdateChildMutation,
  type Patient,
} from "../patients/useChildren";
import { usePatients } from "../patients/usePatients";

type View =
  | { kind: "list" }
  | { kind: "add" }
  | { kind: "edit"; child: Patient }
  | { kind: "intake"; child: Patient }
  | { kind: "documents"; child: Patient };

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
  const [view, setView] = useState<View>({ kind: "list" });

  const children = patients.data?.items ?? [];

  if (view.kind === "add")
    return <AddChild onDone={() => setView({ kind: "list" })} />;
  if (view.kind === "edit") {
    return (
      <EditChild child={view.child} onDone={() => setView({ kind: "list" })} />
    );
  }
  if (view.kind === "documents") {
    return (
      <ChildDocuments
        child={view.child}
        onDone={() => setView({ kind: "list" })}
      />
    );
  }
  if (view.kind === "intake") {
    return (
      <ChildIntake
        child={view.child}
        onDone={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <PageLayout
      title={t("title")}
      intro={t("children.intro")}
      actions={
        <Button type="button" onClick={() => setView({ kind: "add" })}>
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
              <Button type="button" onClick={() => setView({ kind: "add" })}>
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
                      {child.allergies.length === 0
                        ? t("children.noAllergies")
                        : t("children.allergies", {
                            list: child.allergies.join(", "),
                          })}
                    </span>
                  </div>

                  <div className="ml-auto flex flex-wrap gap-field">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-touch"
                      onClick={() => setView({ kind: "intake", child })}
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
                      onClick={() => setView({ kind: "documents", child })}
                    >
                      <Paperclip aria-hidden="true" />
                      {t("children.documents")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-touch"
                      onClick={() => setView({ kind: "edit", child })}
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
