import {
  AsyncSection,
  EmptyState,
  formatNumber,
  Metric,
  MetricRow,
  Section,
  SegmentedControl,
} from "@ketocare/ui";
import type { TFunction } from "i18next";
import { Receipt, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { useSectionTab } from "../../routes/useSectionTab";
import { POLL_MS } from "../assistant/useAssistant";
import { formatCount, formatUsd } from "./format";
import { TableSkeleton } from "./TableSkeleton";
import {
  useAiSpend,
  useAssistantSpeed,
  type AiSpendPeriod,
  type AiSpendReport,
  type AssistantSpeedReport,
} from "./useAiSettings";

const PERIODS = [
  "day",
  "week",
  "month",
] as const satisfies readonly AiSpendPeriod[];

type Line = AiSpendReport["totals"];

/**
 * Кто сколько потратил (ADR-0081, этап 2 аудита архитектуры).
 *
 * Разрезы по группам, задачам, моделям и людям — из одного журнала обращений,
 * и суммы всех разрезов сходятся. Неудачные обращения стоят денег так же, как
 * удачные, и показаны отдельно: без этого «дорогая» задача неотличима от
 * задачи, которая падает и повторяется.
 *
 * Здесь человек и сумма, но не то, о чём он спрашивал: администратор к
 * клиническим данным доступа не имеет.
 */
export function AiSpendPanel() {
  const { t } = useTranslation("admin");
  // Период — в адресе (`?kind=`): ссылку «расход за неделю» можно переслать.
  const [period, setPeriod] = useSectionTab<AiSpendPeriod>(
    "kind",
    PERIODS,
    "month",
  );
  const spend = useAiSpend(period);
  const report = spend.data;

  return (
    <div className="flex flex-col gap-section">
      <div>
        <SegmentedControl<AiSpendPeriod>
          label={t("ai.spend.periodLabel")}
          value={period}
          onChange={setPeriod}
          items={PERIODS.map((value) => ({
            value,
            label: t(`ai.spend.periods.${value}`),
          }))}
        />
      </div>

      <AsyncSection
        {...queryState(spend)}
        skeleton={<TableSkeleton label={t("ai.spend.loading")} columns={4} />}
        error={
          spend.isError
            ? {
                title: t("ai.spend.loadError"),
                description:
                  errorMessageOf(spend.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void spend.refetch()}
        isEmpty={report !== undefined && report.totals.calls === 0}
        empty={
          <EmptyState
            icon={Receipt}
            title={t("ai.spend.empty")}
            description={t(`ai.spend.emptyHint.${period}`)}
          />
        }
      >
        {report && <SpendReport report={report} />}
      </AsyncSection>

      <AssistantSpeedSection period={period} />
    </div>
  );
}

function SpendReport({ report }: { report: AiSpendReport }) {
  const { t } = useTranslation("admin");
  const totals = report.totals;

  return (
    <div className="flex flex-col gap-section">
      <MetricRow label={t("ai.spend.totalsLabel")}>
        <Metric
          label={t("ai.spend.total")}
          value={formatUsd(totals.cost_usd)}
        />
        <Metric label={t("ai.spend.calls")} value={formatCount(totals.calls)} />
        <Metric
          label={t("ai.spend.failed")}
          value={
            totals.failed_calls > 0
              ? t("ai.spend.failedValue", {
                  calls: formatCount(totals.failed_calls),
                  cost: formatUsd(totals.failed_cost_usd),
                })
              : t("ai.spend.none")
          }
        />
      </MetricRow>
      {totals.unpriced_calls > 0 && (
        // Стоимость неизвестна у обращений, оборвавшихся до ответа: модель
        // без цены AiClient не вызывает вовсе (ADR-0080). Об этом надо
        // сказать вслух, иначе сумма выглядит полной.
        <p className="m-0 text-sm text-warning-strong">
          {t("ai.spend.unpriced", {
            calls: formatCount(totals.unpriced_calls),
          })}
        </p>
      )}

      <Section title={t("ai.spend.byGroup")}>
        <SpendTable
          head={t("ai.spend.columns.group")}
          rows={report.by_group.map((line) => ({
            key: line.group,
            label: t(`ai.groups.${line.group}.title`),
            line,
          }))}
        />
      </Section>

      <Section title={t("ai.spend.byKind")}>
        <SpendTable
          head={t("ai.spend.columns.kind")}
          rows={report.by_kind.map((line) => ({
            key: line.kind,
            label: (
              <>
                <span className="block">{t(`ai.kinds.${line.kind}`)}</span>
                <span className="block text-muted-foreground">
                  {t(`ai.groups.${line.group}.title`)}
                </span>
              </>
            ),
            line,
          }))}
        />
      </Section>

      <Section title={t("ai.spend.byModel")}>
        <SpendTable
          head={t("ai.spend.columns.model")}
          tokens
          rows={report.by_model.map((line) => ({
            key: line.model,
            label: line.model || t("ai.spend.noModel"),
            line,
          }))}
        />
      </Section>

      <PeopleSection report={report} />
    </div>
  );
}

function Th({ children, end }: { children: ReactNode; end?: boolean }) {
  return (
    <th
      scope="col"
      className={`py-2 pr-3 font-medium last:pr-0 ${end ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({ children, end }: { children: ReactNode; end?: boolean }) {
  return (
    <td
      className={`py-2 pr-3 last:pr-0 ${end ? "text-right tabular-nums" : ""}`}
    >
      {children}
    </td>
  );
}

function SpendTable({
  head,
  rows,
  tokens = false,
}: {
  head: string;
  rows: { key: string; label: ReactNode; line: Line }[];
  tokens?: boolean;
}) {
  const { t } = useTranslation("admin");

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <Th>{head}</Th>
            {/* Деньги — сразу за названием: на телефоне таблица прокручивается
                вбок, и первым должно быть видно то, ради чего экран открыт. */}
            <Th end>{t("ai.spend.columns.cost")}</Th>
            <Th end>{t("ai.spend.columns.calls")}</Th>
            <Th end>{t("ai.spend.columns.failed")}</Th>
            {tokens && <Th end>{t("ai.spend.columns.tokens")}</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, line }) => (
            <tr
              key={key}
              className="border-b border-border align-top last:border-b-0"
            >
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                {label}
              </th>
              <Td end>
                <span className="font-medium">{formatUsd(line.cost_usd)}</span>
              </Td>
              <Td end>{formatCount(line.calls)}</Td>
              <Td end>
                {line.failed_calls > 0
                  ? t("ai.spend.failedValue", {
                      calls: formatCount(line.failed_calls),
                      cost: formatUsd(line.failed_cost_usd),
                    })
                  : "—"}
              </Td>
              {tokens && (
                <Td end>
                  {t("ai.spend.tokensValue", {
                    input: formatCount(line.tokens_in),
                    output: formatCount(line.tokens_out),
                  })}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeopleSection({ report }: { report: AiSpendReport }) {
  const { t } = useTranslation("admin");

  return (
    <Section
      title={t("ai.spend.people")}
      description={t("ai.spend.peopleIntro")}
    >
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <Th>{t("ai.spend.columns.person")}</Th>
              <Th end>{t("ai.spend.columns.cost")}</Th>
              <Th end>{t("ai.spend.columns.calls")}</Th>
              <Th end>{t("ai.spend.columns.failed")}</Th>
              <Th>{t("ai.spend.columns.groups")}</Th>
            </tr>
          </thead>
          <tbody>
            {report.people.map((person) => (
              <tr
                key={person.user_id}
                className="border-b border-border align-top last:border-b-0"
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  {/* К учётной записи — поиском в списке: у администратора
                      там и роль, и отключение доступа. */}
                  <SectionLink
                    section="users"
                    query={person.search}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {person.full_name}
                  </SectionLink>
                  <span className="block text-muted-foreground">
                    {t(`common:roles.${person.role}`)}
                    {!person.is_active && ` · ${t("ai.spend.inactive")}`}
                  </span>
                </th>
                <Td end>
                  <span className="font-medium">
                    {formatUsd(person.cost_usd)}
                  </span>
                </Td>
                <Td end>{formatCount(person.calls)}</Td>
                <Td end>
                  {person.failed_calls > 0
                    ? formatCount(person.failed_calls)
                    : "—"}
                </Td>
                <Td>
                  {person.groups
                    .map((group) => t(`ai.groups.${group}.title`))
                    .join(", ")}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.people_total > report.people.length && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("ai.spend.peopleShown", {
            shown: formatCount(report.people.length),
            total: formatCount(report.people_total),
          })}
        </p>
      )}
    </Section>
  );
}

/**
 * «850 мс», «4,2 с» или «30 с»: доли секунды, секунды и десятки секунд
 * читаются по-разному — десятая доля у полуминуты уже шум.
 */
function duration(t: TFunction<"admin">, ms: number): string {
  return ms < 1000
    ? t("ai.speed.ms", { value: formatCount(ms) })
    : t("ai.speed.seconds", {
        value: formatNumber(ms / 1000, ms < 10_000 ? 1 : 0),
      });
}

/**
 * Куда уходит время ответа помощника (ADR-0094) — по шагам, за тот же период,
 * что и расход. Обычный случай (медиана) и плохой (каждый десятый ответ):
 * один ответ, застрявший на минуту в повторах, среднее увёл бы далеко от того,
 * сколько семья обычно ждёт, а медиана его спрятала бы.
 *
 * Только длительности: ни вопроса, ни ответа, ни человека.
 */
function AssistantSpeedSection({ period }: { period: AiSpendPeriod }) {
  const { t } = useTranslation("admin");
  const speed = useAssistantSpeed(period);
  const report = speed.data;

  return (
    <Section title={t("ai.speed.title")} description={t("ai.speed.intro")}>
      <AsyncSection
        {...queryState(speed)}
        skeleton={<TableSkeleton label={t("ai.speed.loading")} columns={4} />}
        error={
          speed.isError
            ? {
                title: t("ai.speed.loadError"),
                description:
                  errorMessageOf(speed.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void speed.refetch()}
        isEmpty={report !== undefined && report.total === null}
        empty={
          <EmptyState
            icon={Timer}
            title={t("ai.speed.empty")}
            description={t(`ai.spend.emptyHint.${period}`)}
          />
        }
      >
        {report?.total && <SpeedReport report={report} total={report.total} />}
      </AsyncSection>
    </Section>
  );
}

function SpeedReport({
  report,
  total,
}: {
  report: AssistantSpeedReport;
  total: NonNullable<AssistantSpeedReport["total"]>;
}) {
  const { t } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-section">
      <MetricRow label={t("ai.speed.totalsLabel")}>
        <Metric
          label={t("ai.speed.usual")}
          value={duration(t, total.median_ms)}
        />
        <Metric label={t("ai.speed.slow")} value={duration(t, total.p90_ms)} />
        <Metric label={t("ai.speed.worst")} value={duration(t, total.max_ms)} />
        <Metric
          label={t("ai.speed.answers")}
          value={formatCount(total.count)}
        />
      </MetricRow>

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <Th>{t("ai.speed.columns.step")}</Th>
              <Th end>{t("ai.speed.columns.usual")}</Th>
              <Th end>{t("ai.speed.columns.slow")}</Th>
              <Th end>{t("ai.speed.columns.worst")}</Th>
              <Th end>{t("ai.speed.columns.count")}</Th>
            </tr>
          </thead>
          <tbody>
            {report.steps.map((line) => (
              <tr
                key={line.step}
                className="border-b border-border align-top last:border-b-0"
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="block">
                    {t(`ai.speed.steps.${line.step}.title`)}
                  </span>
                  <span className="block text-muted-foreground">
                    {t(`ai.speed.steps.${line.step}.hint`)}
                  </span>
                </th>
                <Td end>
                  <span className="font-medium">
                    {duration(t, line.median_ms)}
                  </span>
                </Td>
                <Td end>{duration(t, line.p90_ms)}</Td>
                <Td end>{duration(t, line.max_ms)}</Td>
                <Td end>{formatCount(line.count)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Последний шаг сервер не видит: экран сам спрашивает, готов ли
          ответ. Без этой строки сумма шагов казалась бы всем ожиданием. */}
      <p className="m-0 text-sm text-muted-foreground">
        {t("ai.speed.poll", { value: duration(t, POLL_MS) })}
      </p>

      {report.by_model.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="pb-2 text-left font-medium">
              {t("ai.speed.byModel")}
            </caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <Th>{t("ai.spend.columns.model")}</Th>
                <Th end>{t("ai.speed.columns.usual")}</Th>
                <Th end>{t("ai.speed.columns.slow")}</Th>
                <Th end>{t("ai.speed.columns.worst")}</Th>
                <Th end>{t("ai.speed.columns.count")}</Th>
              </tr>
            </thead>
            <tbody>
              {report.by_model.map((line) => (
                <tr
                  key={line.model}
                  className="border-b border-border align-top last:border-b-0"
                >
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {line.model}
                  </th>
                  <Td end>
                    <span className="font-medium">
                      {duration(t, line.median_ms)}
                    </span>
                  </Td>
                  <Td end>{duration(t, line.p90_ms)}</Td>
                  <Td end>{duration(t, line.max_ms)}</Td>
                  <Td end>{formatCount(line.count)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="m-0 text-sm text-muted-foreground">
        {t("ai.speed.outcomesLabel")}{" "}
        {report.outcomes
          .map((line) =>
            t("ai.speed.outcomeValue", {
              outcome: t(`ai.speed.outcomes.${line.outcome}`),
              value: formatCount(line.count),
            }),
          )
          .join(", ")}
      </p>
    </div>
  );
}
