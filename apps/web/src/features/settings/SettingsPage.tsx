import {
  AsyncSection,
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  toast,
} from "@ketocare/ui";
import { Baby, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { ChildForm } from "./ChildForm";
import { toChildBody, toChildUpdateBody } from "./childSchemas";
import {
  useCreateChildMutation,
  useUpdateChildMutation,
  type Patient,
} from "../patients/useChildren";
import { usePatients } from "../patients/usePatients";

type View =
  { kind: "list" } | { kind: "add" } | { kind: "edit"; child: Patient };

/**
 * Настройки родителя: дети и их профили.
 *
 * Раздел `settings` объявлен в разделе 8.1 ТЗ для родителя, но критериев приёмки
 * в 8.3 у него нет. Здесь он получает то, без чего кабинет не работает: завести
 * ребёнка было нельзя вовсе, а рост и аллергии — изменить (см. ADR-0003 и
 * docs/AUDIT_USER_PATH.md). Смена пароля появится здесь же.
 */
export function SettingsPage() {
  const { t } = useTranslation("settings");
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

                  <Button
                    type="button"
                    variant="outline"
                    className="ml-auto min-h-touch"
                    onClick={() => setView({ kind: "edit", child })}
                  >
                    {t("children.edit")}
                  </Button>
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
  const { t } = useTranslation("settings");
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
  const { t } = useTranslation("settings");
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
