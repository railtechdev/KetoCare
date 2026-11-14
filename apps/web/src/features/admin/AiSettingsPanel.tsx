import {
  AsyncSection,
  Badge,
  Button,
  ConfirmDialog,
  FormSheet,
  formatOccurredAt,
  Metric,
  MetricRow,
  Section,
  SegmentedControl,
} from "@ketocare/ui";
import { useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { useSectionTab } from "../../routes/useSectionTab";
import { AiBudgetAlerts } from "./AiBudgetAlerts";
import { AiModelForm, AiProviderForm } from "./AiCatalogForms";
import {
  AiGroupForm,
  AiKeyForm,
  AiProjectForm,
  KeyCheckResult,
} from "./AiForms";
import { AiSpendPanel } from "./AiSpendPanel";
import { formatCount, formatUsd } from "./format";
import { TableSkeleton } from "./TableSkeleton";
import {
  useAiSettings,
  useCheckAiKey,
  useRemoveAiKey,
  useRemoveAiModel,
  useRemoveAiProvider,
  type AiGroupName,
  type AiGroupView,
  type AiModelView,
  type AiProviderView,
  type AiSettings,
} from "./useAiSettings";

type Sheet =
  | { kind: "key"; provider: string }
  | { kind: "provider"; provider?: string }
  | { kind: "model"; ref?: string }
  | { kind: "project" }
  | { kind: "group"; group: AiGroupName };

/** Виды раздела (`?tab=`): настройки и расход. */
const AI_VIEWS = ["settings", "spend"] as const;
type AiView = (typeof AI_VIEWS)[number];

/**
 * Раздел «Модели и расход» администратора.
 *
 * Два вида: настройки (ADR-0080, ADR-0082) и расход — кто сколько потратил
 * (ADR-0081). Вид живёт в адресе: «расход за неделю» — это ссылка.
 */
export function AiSection() {
  const { t } = useTranslation("admin");
  const [view, setView] = useSectionTab<AiView>("tab", AI_VIEWS, "settings");

  return (
    <div className="flex flex-col gap-section">
      <div>
        <SegmentedControl<AiView>
          label={t("ai.views.label")}
          value={view}
          onChange={setView}
          items={[
            { value: "settings", label: t("ai.views.settings") },
            { value: "spend", label: t("ai.views.spend") },
          ]}
        />
      </div>
      {view === "settings" ? <AiSettingsPanel /> : <AiSpendPanel />}
    </div>
  );
}

/**
 * Настройки: подключения к поставщикам, каталог моделей, бюджеты и группы
 * задач. Всё меняется здесь, без выката и без разработчика: новый поставщик —
 * это подключение, новая модель — запись каталога с ценой (ADR-0082).
 * Содержимого запросов здесь нет и не будет: администратор к клиническим
 * данным доступа не имеет.
 */
export function AiSettingsPanel() {
  const { t } = useTranslation("admin");
  const settings = useAiSettings();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const close = () => setSheet(null);

  const data = settings.data;
  const editedGroup =
    sheet?.kind === "group"
      ? data?.groups.find((g) => g.group === sheet.group)
      : undefined;
  const keyProvider =
    sheet?.kind === "key"
      ? data?.providers.find((p) => p.id === sheet.provider)
      : undefined;
  const editedProvider =
    sheet?.kind === "provider" && sheet.provider
      ? data?.providers.find((p) => p.id === sheet.provider)
      : undefined;
  const editedModel =
    sheet?.kind === "model" && sheet.ref
      ? data?.models.find((m) => m.ref === sheet.ref)
      : undefined;

  const sheetTitle = () => {
    switch (sheet?.kind) {
      case "key":
        return t("ai.key.replaceTitle", { provider: keyProvider?.name ?? "" });
      case "provider":
        return sheet.provider
          ? t("ai.providerForm.editTitle")
          : t("ai.providerForm.title");
      case "model":
        return sheet.ref
          ? t("ai.modelForm.editTitle")
          : t("ai.modelForm.title");
      case "project":
        return t("ai.project.title");
      default:
        return t("ai.groupForm.title");
    }
  };

  return (
    <AsyncSection
      {...queryState(settings)}
      skeleton={<TableSkeleton label={t("ai.loading")} columns={5} />}
      error={
        settings.isError
          ? {
              title: t("ai.loadError"),
              description:
                errorMessageOf(settings.error) ?? t("common:errors.unexpected"),
            }
          : null
      }
      retryLabel={t("common:actions.retry")}
      onRetry={() => void settings.refetch()}
      isEmpty={false}
      empty={null}
    >
      {data && (
        <div className="flex flex-col gap-section">
          <AiBudgetAlerts alerts={data.alerts} />
          <ProvidersSection
            settings={data}
            onAdd={() => setSheet({ kind: "provider" })}
            onEdit={(provider) => setSheet({ kind: "provider", provider })}
            onKey={(provider) => setSheet({ kind: "key", provider })}
          />
          <ModelsSection
            settings={data}
            onAdd={() => setSheet({ kind: "model" })}
            onEdit={(ref) => setSheet({ kind: "model", ref })}
          />
          <ProjectSection
            settings={data}
            onEdit={() => setSheet({ kind: "project" })}
          />
          <GroupsSection
            settings={data}
            onEdit={(group) => setSheet({ kind: "group", group })}
          />
          <p className="m-0 text-sm text-muted-foreground">
            {t("ai.appliesWithin", { count: data.applies_within_s })}
          </p>

          <FormSheet
            open={sheet !== null}
            onOpenChange={(open) => {
              if (!open) close();
            }}
            title={sheetTitle()}
            closeLabel={t("common:actions.close")}
          >
            {keyProvider && <AiKeyForm provider={keyProvider} onDone={close} />}
            {sheet?.kind === "provider" && (
              <AiProviderForm
                key={sheet.provider ?? "new"}
                provider={editedProvider}
                kinds={data.provider_kinds}
                existing={data.providers}
                onDone={close}
              />
            )}
            {sheet?.kind === "model" && (
              <AiModelForm
                key={sheet.ref ?? "new"}
                model={editedModel}
                providers={data.providers}
                onDone={close}
              />
            )}
            {sheet?.kind === "project" && (
              <AiProjectForm project={data.project} onDone={close} />
            )}
            {editedGroup && (
              <AiGroupForm
                group={editedGroup}
                models={data.models}
                onDone={close}
              />
            )}
          </FormSheet>
        </div>
      )}
    </AsyncSection>
  );
}

function Th({ children }: { children?: ReactNode }) {
  return (
    <th scope="col" className="py-2 pr-3 text-left font-medium last:pr-0">
      {children}
    </th>
  );
}

function keyState(provider: AiProviderView, t: TFunction<"admin">): string {
  const key = provider.key;
  if (key.configured) {
    return key.source === "admin"
      ? t("ai.key.state.admin", { hint: key.hint })
      : t("ai.key.state.env");
  }
  return provider.kind === "ollama" || provider.kind === "openai_compatible"
    ? t("ai.key.state.notNeeded")
    : t("ai.key.state.none");
}

/**
 * Подключения к поставщикам моделей. Ключ только записывается: после
 * сохранения видны последние четыре знака, дата и автор замены.
 */
function ProvidersSection({
  settings,
  onAdd,
  onEdit,
  onKey,
}: {
  settings: AiSettings;
  onAdd: () => void;
  onEdit: (provider: string) => void;
  onKey: (provider: string) => void;
}) {
  const { t } = useTranslation("admin");
  const check = useCheckAiKey();
  const removeKey = useRemoveAiKey();
  const remove = useRemoveAiProvider();
  const [checked, setChecked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    action: "key" | "provider";
    provider: AiProviderView;
  } | null>(null);

  return (
    <Section
      title={t("ai.providers.title")}
      description={t("ai.providers.intro")}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          {t("ai.providers.add")}
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <Th>{t("ai.providers.columns.provider")}</Th>
              <Th>{t("ai.providers.columns.key")}</Th>
              <Th>{t("ai.providers.columns.models")}</Th>
              <Th>
                <span className="sr-only">
                  {t("ai.groups.columns.actions")}
                </span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {settings.providers.map((provider) => (
              <tr
                key={provider.id}
                className="border-b border-border align-top last:border-b-0"
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {provider.name}
                    {!provider.enabled && (
                      <Badge variant="secondary">{t("ai.providers.off")}</Badge>
                    )}
                    {provider.enabled && !provider.ready && (
                      <Badge variant="secondary">
                        {t("ai.providers.notReady")}
                      </Badge>
                    )}
                  </span>
                  <span className="block text-muted-foreground">
                    {t(`ai.providerKinds.${provider.kind}.title`)}
                    {provider.base_url && ` · ${provider.base_url}`}
                  </span>
                </th>
                <td className="py-2 pr-3">
                  <span className="block">{keyState(provider, t)}</span>
                  {provider.key.source === "admin" &&
                    provider.key.updated_at && (
                      <span className="block text-muted-foreground">
                        {t("ai.key.updatedValue", {
                          when: formatOccurredAt(
                            new Date(provider.key.updated_at),
                          ),
                          who:
                            provider.key.updated_by_name ??
                            t("ai.key.unknownAuthor"),
                        })}
                      </span>
                    )}
                  {provider.key.unreadable && (
                    // Ключ шифрования сменился: введённый ключ не прочесть.
                    // Молчать нельзя — администратор думает, что стоит его ключ.
                    <span className="block text-warning-strong">
                      {t("ai.key.unreadable")}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatCount(provider.models_count)}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t("ai.providers.keyAria", {
                        provider: provider.name,
                      })}
                      onClick={() => onKey(provider.id)}
                    >
                      {provider.key.source === "admin"
                        ? t("ai.key.replace")
                        : t("ai.key.set")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={check.isPending}
                      aria-label={t("ai.providers.checkAria", {
                        provider: provider.name,
                      })}
                      onClick={() => {
                        setChecked(provider.id);
                        check.mutate({ providerId: provider.id, apiKey: null });
                      }}
                    >
                      {check.isPending && checked === provider.id
                        ? t("ai.key.checking")
                        : t("ai.key.check")}
                    </Button>
                    {provider.key.source === "admin" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t("ai.providers.removeKeyAria", {
                          provider: provider.name,
                        })}
                        onClick={() =>
                          setConfirming({ action: "key", provider })
                        }
                      >
                        {t("ai.key.remove")}
                      </Button>
                    )}
                    {!provider.builtin && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t("ai.providers.editAria", {
                            provider: provider.name,
                          })}
                          onClick={() => onEdit(provider.id)}
                        >
                          {t("ai.edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t("ai.providers.removeAria", {
                            provider: provider.name,
                          })}
                          onClick={() =>
                            setConfirming({ action: "provider", provider })
                          }
                        >
                          {t("ai.providers.remove")}
                        </Button>
                      </>
                    )}
                  </div>
                  {checked === provider.id && (
                    <KeyCheckResult
                      result={check.data}
                      error={check.isError ? check.error : null}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(remove.isError || removeKey.isError) && (
        <p className="m-0 text-sm text-destructive" role="alert">
          {errorMessageOf(remove.error ?? removeKey.error) ??
            t("common:errors.unexpected")}
        </p>
      )}
      <p className="m-0 text-sm text-muted-foreground">
        {settings.encryption === "dedicated"
          ? t("ai.key.encryptionDedicated")
          : t("ai.key.encryptionDerived")}
      </p>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          confirming?.action === "provider"
            ? t("ai.providers.removeTitle", {
                provider: confirming.provider.name,
              })
            : t("ai.key.removeTitle", {
                provider: confirming?.provider.name ?? "",
                hint: confirming?.provider.key.hint ?? "",
              })
        }
        description={
          confirming?.action === "provider"
            ? t("ai.providers.removeDescription")
            : t("ai.key.removeDescription")
        }
        confirmLabel={
          confirming?.action === "provider"
            ? t("ai.providers.remove")
            : t("ai.key.remove")
        }
        cancelLabel={t("common:actions.cancel")}
        destructive
        onConfirm={() => {
          if (!confirming) return;
          if (confirming.action === "provider") {
            remove.mutate(confirming.provider.id);
          } else {
            removeKey.mutate(confirming.provider.id);
          }
        }}
      />
    </Section>
  );
}

/**
 * Каталог моделей: что можно выбрать в группах задач и по какой цене считается
 * расход. Встроенные записи — прайс-лист из кода; их цену можно поправить, а
 * новую модель любого подключения — добавить, не дожидаясь выката.
 */
function ModelsSection({
  settings,
  onAdd,
  onEdit,
}: {
  settings: AiSettings;
  onAdd: () => void;
  onEdit: (ref: string) => void;
}) {
  const { t } = useTranslation("admin");
  const remove = useRemoveAiModel();
  const [confirming, setConfirming] = useState<AiModelView | null>(null);
  const providerName = (id: string) =>
    settings.providers.find((provider) => provider.id === id)?.name ?? id;

  return (
    <Section
      title={t("ai.models.title")}
      description={t("ai.models.intro")}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          {t("ai.models.add")}
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <Th>{t("ai.models.columns.model")}</Th>
              <Th>{t("ai.models.columns.provider")}</Th>
              <Th>{t("ai.models.columns.price")}</Th>
              <Th>
                <span className="sr-only">
                  {t("ai.groups.columns.actions")}
                </span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {settings.models.map((model) => (
              <tr
                key={model.ref}
                className="border-b border-border align-top last:border-b-0"
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {model.name ?? model.model}
                    {!model.enabled && (
                      <Badge variant="secondary">{t("ai.models.off")}</Badge>
                    )}
                    {model.enabled && !model.usable && (
                      <Badge variant="secondary">
                        {t("ai.models.unusable")}
                      </Badge>
                    )}
                    {model.in_use && (
                      <Badge variant="outline">{t("ai.models.inUse")}</Badge>
                    )}
                  </span>
                  {model.name && (
                    <span className="block text-muted-foreground">
                      {model.model}
                    </span>
                  )}
                </th>
                <td className="py-2 pr-3">{providerName(model.provider)}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {t("ai.models.priceValue", {
                    priceIn: formatUsd(model.usd_per_mtok_in),
                    priceOut: formatUsd(model.usd_per_mtok_out),
                  })}
                  {model.overridden && (
                    <span className="block text-muted-foreground">
                      {t("ai.models.overridden")}
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t("ai.models.editAria", {
                        model: model.ref,
                      })}
                      onClick={() => onEdit(model.ref)}
                    >
                      {t("ai.edit")}
                    </Button>
                    {(!model.builtin || model.overridden) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t(
                          model.builtin
                            ? "ai.models.restoreAria"
                            : "ai.models.removeAria",
                          { model: model.ref },
                        )}
                        onClick={() => setConfirming(model)}
                      >
                        {model.builtin
                          ? t("ai.models.restore")
                          : t("ai.models.remove")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {remove.isError && (
        <p className="m-0 text-sm text-destructive" role="alert">
          {errorMessageOf(remove.error) ?? t("common:errors.unexpected")}
        </p>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t(
          confirming?.builtin
            ? "ai.models.restoreTitle"
            : "ai.models.removeTitle",
          { model: confirming?.ref ?? "" },
        )}
        description={t(
          confirming?.builtin
            ? "ai.models.restoreDescription"
            : "ai.models.removeDescription",
        )}
        confirmLabel={
          confirming?.builtin ? t("ai.models.restore") : t("ai.models.remove")
        }
        cancelLabel={t("common:actions.cancel")}
        destructive={!confirming?.builtin}
        onConfirm={() => {
          if (confirming) remove.mutate(confirming.ref);
        }}
      />
    </Section>
  );
}

function spent(
  value: string,
  budget: string | null | undefined,
  t: TFunction<"admin">,
) {
  return budget
    ? t("ai.spentOf", { spent: formatUsd(value), budget: formatUsd(budget) })
    : formatUsd(value);
}

function ProjectSection({
  settings,
  onEdit,
}: {
  settings: AiSettings;
  onEdit: () => void;
}) {
  const { t } = useTranslation("admin");
  const project = settings.project;
  const daily = project.daily_budget_usd ?? project.default_daily_budget_usd;

  return (
    <Section
      title={t("ai.project.title")}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          {t("ai.edit")}
        </Button>
      }
    >
      <MetricRow>
        <Metric
          label={t("ai.project.today")}
          value={spent(project.spend.today_usd, daily, t)}
        />
        <Metric
          label={t("ai.project.month")}
          value={
            project.monthly_budget_usd
              ? spent(project.spend.month_usd, project.monthly_budget_usd, t)
              : t("ai.project.monthUncapped", {
                  spent: formatUsd(project.spend.month_usd),
                })
          }
        />
      </MetricRow>
    </Section>
  );
}

function GroupsSection({
  settings,
  onEdit,
}: {
  settings: AiSettings;
  onEdit: (group: AiGroupName) => void;
}) {
  const { t } = useTranslation("admin");

  return (
    <Section title={t("ai.groups.title")}>
      <p className="m-0 text-sm text-muted-foreground">
        {t("ai.groups.intro")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("ai.groups.columns.group")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("ai.groups.columns.model")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("ai.groups.columns.today")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("ai.groups.columns.month")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("ai.groups.columns.limit")}
              </th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">
                  {t("ai.groups.columns.actions")}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {settings.groups.map((group) => (
              <GroupRow key={group.group} group={group} onEdit={onEdit} />
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function GroupRow({
  group,
  onEdit,
}: {
  group: AiGroupView;
  onEdit: (group: AiGroupName) => void;
}) {
  const { t } = useTranslation("admin");
  const title = t(`ai.groups.${group.group}.title`);

  return (
    <tr className="border-b border-border align-top last:border-b-0">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {title}
          {!group.enabled && (
            <Badge variant="secondary">{t("ai.groups.off")}</Badge>
          )}
        </span>
      </th>
      <td className="py-2 pr-3">
        {/* По задаче на строку: у задач одной группы модели могут быть
            разные, и видно должно быть, какая работает и откуда она. */}
        {group.tasks.map((task) => (
          <span key={task.kind} className="block">
            <span className="text-muted-foreground">
              {t("ai.groups.taskLabel", { task: t(`ai.kinds.${task.kind}`) })}
            </span>{" "}
            {task.effective_model || t("ai.groups.noModel")}
            {task.source === "env" && (
              <span className="text-muted-foreground">
                {" "}
                {t("ai.groups.fromEnv")}
              </span>
            )}
            {task.effective_model && !task.usable && (
              <span className="text-warning-strong">
                {" "}
                {t("ai.groups.taskUnusable")}
              </span>
            )}
          </span>
        ))}
      </td>
      <td className="py-2 pr-3">
        {spent(group.spend.today_usd, group.daily_budget_usd, t)}
      </td>
      <td className="py-2 pr-3">
        {spent(group.spend.month_usd, group.monthly_budget_usd, t)}
      </td>
      <td className="py-2 pr-3">
        <span className="block">
          {group.per_person_kinds.length === 0
            ? t("ai.groups.noLimit")
            : t("ai.groups.limitValue", {
                count: group.user_daily_limit ?? group.default_user_daily_limit,
              })}
        </span>
        {group.user_daily_budget_usd && (
          <span className="block text-muted-foreground">
            {t("ai.groups.userBudgetValue", {
              budget: formatUsd(group.user_daily_budget_usd),
            })}
          </span>
        )}
      </td>
      <td className="py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("ai.groups.editAria", { group: title })}
          onClick={() => onEdit(group.group)}
        >
          {t("ai.edit")}
        </Button>
      </td>
    </tr>
  );
}
