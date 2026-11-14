import {
  AsyncSection,
  Badge,
  Button,
  ConfirmDialog,
  Fact,
  FactList,
  FormSheet,
  formatOccurredAt,
  Metric,
  MetricRow,
  Section,
} from "@ketocare/ui";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import {
  AiGroupForm,
  AiKeyForm,
  AiProjectForm,
  KeyCheckResult,
} from "./AiForms";
import { formatUsd } from "./format";
import { TableSkeleton } from "./TableSkeleton";
import {
  useAiSettings,
  useCheckAiKey,
  useRemoveAiKey,
  type AiGroupName,
  type AiGroupView,
  type AiSettings,
} from "./useAiSettings";

type Sheet =
  { kind: "key" } | { kind: "project" } | { kind: "group"; group: AiGroupName };

/**
 * Раздел «ИИ» администратора (ADR-0080).
 *
 * Ключ, модели, бюджеты и лимиты меняются здесь, без выката: прежде всё это
 * лежало в секретах репозитория. Расход показан суммами по группам — кто
 * именно потратил и на что, появится вторым этапом аудита; содержимого
 * запросов здесь нет и не будет: администратор к клиническим данным доступа не
 * имеет.
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
          <KeySection
            settings={data}
            onReplace={() => setSheet({ kind: "key" })}
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
            title={
              sheet?.kind === "key"
                ? t("ai.key.replaceTitle")
                : sheet?.kind === "project"
                  ? t("ai.project.title")
                  : t("ai.groupForm.title")
            }
            closeLabel={t("common:actions.close")}
          >
            {sheet?.kind === "key" && <AiKeyForm onDone={close} />}
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

function KeySection({
  settings,
  onReplace,
}: {
  settings: AiSettings;
  onReplace: () => void;
}) {
  const { t } = useTranslation("admin");
  const check = useCheckAiKey();
  const remove = useRemoveAiKey();
  const [confirming, setConfirming] = useState(false);
  const key = settings.key;

  const state = !key.configured
    ? t("ai.key.state.none")
    : key.source === "admin"
      ? t("ai.key.state.admin", { hint: key.hint })
      : t("ai.key.state.env");

  return (
    <Section title={t("ai.key.title")}>
      <FactList>
        <Fact label={t("ai.key.stateLabel")} value={state} />
        {key.source === "admin" && key.updated_at && (
          <Fact
            label={t("ai.key.updated")}
            value={t("ai.key.updatedValue", {
              when: formatOccurredAt(new Date(key.updated_at)),
              who: key.updated_by_name ?? t("ai.key.unknownAuthor"),
            })}
          />
        )}
      </FactList>

      {key.unreadable && (
        // Ключ шифрования сменился: введённый ключ не прочесть, работает
        // запасной из окружения. Молчать об этом нельзя — администратор
        // думает, что стоит его ключ.
        <p className="m-0 text-sm text-warning-strong">
          {t("ai.key.unreadable")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onReplace}>
          {key.source === "admin" ? t("ai.key.replace") : t("ai.key.set")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!key.configured || check.isPending}
          onClick={() => check.mutate(null)}
        >
          {check.isPending ? t("ai.key.checking") : t("ai.key.check")}
        </Button>
        {key.source === "admin" && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirming(true)}
          >
            {t("ai.key.remove")}
          </Button>
        )}
      </div>

      <KeyCheckResult
        result={check.data}
        error={check.isError ? check.error : null}
      />
      <p className="m-0 text-sm text-muted-foreground">
        {key.encryption === "dedicated"
          ? t("ai.key.encryptionDedicated")
          : t("ai.key.encryptionDerived")}
      </p>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("ai.key.removeTitle", { hint: key.hint })}
        description={t("ai.key.removeDescription")}
        confirmLabel={t("ai.key.remove")}
        cancelLabel={t("common:actions.cancel")}
        destructive
        onConfirm={() => remove.mutate()}
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
  const model = group.model ?? group.defaults.model;
  const fast = group.has_fast
    ? (group.model_fast ?? group.defaults.model_fast)
    : null;

  return (
    <tr className="border-b border-border align-top last:border-b-0">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {title}
          {!group.enabled && (
            <Badge variant="secondary">{t("ai.groups.off")}</Badge>
          )}
        </span>
        <span className="block text-muted-foreground">
          {group.kinds.map((kind) => t(`ai.kinds.${kind}`)).join(", ")}
        </span>
      </th>
      <td className="py-2 pr-3">
        <span className="block">{model || t("ai.groups.noModel")}</span>
        {fast && (
          <span className="block text-muted-foreground">
            {t("ai.groups.fastModel", { model: fast })}
          </span>
        )}
        {!group.model && (
          <span className="block text-muted-foreground">
            {t("ai.groups.fromEnv")}
          </span>
        )}
      </td>
      <td className="py-2 pr-3">
        {spent(group.spend.today_usd, group.daily_budget_usd, t)}
      </td>
      <td className="py-2 pr-3">
        {spent(group.spend.month_usd, group.monthly_budget_usd, t)}
      </td>
      <td className="py-2 pr-3">
        {group.per_person_kinds.length === 0
          ? t("ai.groups.noLimit")
          : t("ai.groups.limitValue", {
              count: group.user_daily_limit ?? group.defaults.user_daily_limit,
            })}
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
