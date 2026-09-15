import {
  AsyncSection,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  FormSheet,
  RatioBadge,
  useDebouncedValue,
  SEARCH_DELAY_MS,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { SearchX, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { PatientViewLink } from "./PatientViewLink";
import { useNavigate } from "@tanstack/react-router";

import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { usePatients } from "../patients/usePatients";
import { PatientFlagsLegend, PatientFlagsView } from "./PatientFlagsView";
import { ageInMonths } from "./dates";
import { usePatientOverviews } from "./doctorQueries";
import { attentionRank, computePatientFlags, type PatientFlags } from "./flags";
import { TableSkeleton } from "./skeletons";
import type { Patient } from "./types";
import { ChildForm } from "../child/ChildForm";
import { toChildBody } from "../child/childSchemas";
import { useCreateChildMutation } from "../patients/useChildren";

interface PatientRow {
  patient: Patient;
  name: string;
  ageMonths: number | null;
  ratio: number | null;
  kcalPerDay: number | null;
  flags: PatientFlags | null;
  attention: number;
}

/** Список пациентов врача с флагами (раздел 8.3 ТЗ, «Врач / Пациенты»). */

export function PatientsListView() {
  const { t } = useTranslation("doctor");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const navigate = useNavigate();
  const createChild = useCreateChildMutation();

  // Поиск уходит на сервер (см. `usePatients`), поэтому список уже отобран.
  const debouncedQuery = useDebouncedValue(query, SEARCH_DELAY_MS);
  const patients = usePatients(debouncedQuery);
  const items = useMemo(() => patients.data?.items ?? [], [patients.data]);

  const overviews = usePatientOverviews(
    useMemo(() => items.map((patient) => patient.id), [items]),
  );

  const settled = !overviews.pending;

  const rows = useMemo<PatientRow[]>(() => {
    const now = new Date();

    return items
      .map((patient) => {
        const overview = overviews.byPatientId.get(patient.id) ?? null;
        const flags = computePatientFlags(overview);

        return {
          patient,
          name: patient.full_name,
          ageMonths: ageInMonths(patient.birth_date, now),
          ratio: overview?.prescription?.ratio ?? null,
          kcalPerDay: overview?.prescription?.kcal_per_day ?? null,
          flags,
          attention: attentionRank(flags),
        };
      })
      .sort(
        (left, right) =>
          // Порядок по умолчанию — требующие внимания сверху: врач открывает
          // список, чтобы найти именно их, а не чтобы читать его целиком.
          //
          // Пока сводки грузятся, порядок алфавитный и не меняется с каждым
          // пришедшим ответом: строка, уезжающая из-под курсора, — это открытая
          // карта не того пациента. Перестановка происходит один раз, вместе с
          // появлением самих флагов.
          (settled ? right.attention - left.attention : 0) ||
          left.name.localeCompare(right.name, "ru-RU"),
      );
  }, [items, overviews.byPatientId, settled]);

  const columns = useMemo<ColumnDef<PatientRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("list.columns.name"),
        // Имя — ссылка, а не текст рядом с кнопкой в отдельном столбце: карта
        // пациента живёт по адресу (правило П1), и ссылку врач открывает в
        // новой вкладке, копирует и пересылает — с кнопкой ничего этого нельзя.
        // Освободившийся столбец возвращает таблице ширину, которую П19 просит
        // держать узкой.
        cell: ({ row }) => (
          <PatientViewLink
            patientId={row.original.patient.id}
            className="font-medium underline-offset-2 hover:underline"
          >
            {row.original.name}
          </PatientViewLink>
        ),
      },
      {
        accessorKey: "ageMonths",
        header: t("list.columns.age"),
        cell: ({ row }) => <AgeCell months={row.original.ageMonths} />,
      },
      {
        accessorKey: "ratio",
        header: t("list.columns.ratio"),
        cell: ({ row }) =>
          row.original.ratio === null ? (
            <span className="text-sm text-muted-foreground">
              {t("list.noPrescription")}
            </span>
          ) : (
            <RatioBadge ratio={row.original.ratio} />
          ),
      },
      {
        accessorKey: "kcalPerDay",
        header: t("list.columns.kcal"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.kcalPerDay === null
              ? "—"
              : t("list.kcalValue", { value: row.original.kcalPerDay })}
          </span>
        ),
      },
      {
        id: "flags",
        header: t("list.columns.flags"),
        enableSorting: false,
        // Пока сводка не пришла, в ячейке скелетон, а не прочерк: прочерк
        // читается как «замечаний нет», и это разные утверждения.
        cell: ({ row }) => (
          <PatientFlagsView
            flags={row.original.flags}
            pending={overviews.pending}
          />
        ),
      },
    ],
    [overviews.pending, t],
  );

  return (
    // Реестр — страница, на которой работают: восемь столбцов в колонке 1152 px
    // жались, оставляя на мониторе 1920 четверть окна пустой. Плотность —
    // `compact` на весь экран: правило П26 канона, блоки её наследуют.
    <PageLayout
      title={t("list.title")}
      intro={t("list.intro")}
      width="wide"
      density="compact"
      actions={
        <Button type="button" onClick={() => setInviteOpen(true)}>
          <UserPlus aria-hidden="true" />
          {t("list.createAction")}
        </Button>
      }
    >
      <FilterBar label={t("list.filtersLabel")}>
        <Field
          id="patient-search"
          width="wide"
          type="search"
          label={t("list.search.label")}
          placeholder={t("list.search.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </FilterBar>

      {/* Ошибка обновления списка не прячет уже показанных пациентов: врач,
          у которого строки исчезли за красным блоком, решает, что потерял
          доступ к своим пациентам. */}
      <AsyncSection
        loading={patients.isPending}
        skeleton={<TableSkeleton label={t("list.loading")} />}
        error={
          patients.isError
            ? {
                title: t("list.loadError"),
                description:
                  errorMessageOf(patients.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void patients.refetch()}
        isEmpty={rows.length === 0}
        empty={
          debouncedQuery.trim() === "" ? (
            <EmptyState
              icon={Users}
              title={t("list.empty")}
              description={t("list.emptyDescription")}
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title={t("list.emptySearch")}
              description={t("list.emptySearchDescription")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setQuery("")}
                >
                  {t("list.resetSearch")}
                </Button>
              }
            />
          )
        }
      >
        {/* Флаги появляются по мере ответов на сводки: в ячейках скелетон,
            а состояние проговаривается один раз на весь список. */}
        {overviews.pending && (
          <p role="status" className="sr-only">
            {t("list.flagsLoading")}
          </p>
        )}

        {/* У пациента, чью сводку получить не удалось, флагов нет. Раньше об
            этом сообщал серый абзац того же цвета, что и подписи таблицы, и
            повторить запрос было нечем — помогала только перезагрузка
            страницы (правило П15 канона). */}
        {overviews.failed && (
          <ErrorState
            className="mb-block"
            title={t("list.flagsFailedTitle")}
            description={t("list.flagsFailed")}
            retryLabel={t("common:actions.retry")}
            onRetry={overviews.refetch}
          />
        )}

        <DataTable
          columns={columns}
          data={rows}
          caption={t("list.caption")}
          // Пустое состояние — у `AsyncSection`, иначе оно рисовалось бы
          // дважды: и вместо таблицы, и вместо всего блока.
          emptyState={null}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />

        <PatientFlagsLegend />
      </AsyncSection>
      {/* Пригласивший семью специалист становится ведущим для её ребёнка, как
          только родитель заведёт профиль (ADR-0003). Другого способа получить
          пациента у врача нет: «взять» чужого пациента нельзя.

          Панелью, а не блоком над списком: врач приходит сюда за триажем, а
          приглашает семью считаные разы (правило П32 канона). */}
      <FormSheet
        closeLabel={t("common:actions.close")}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title={t("list.createTitle")}
        description={t("list.createIntro")}
      >
        {/* Форма та же, что у правки профиля: поля ребёнка одни и те же, и
            вторая их копия разошлась бы с первой (ADR-0040). */}
        <ChildForm
          child={null}
          pending={createChild.isPending}
          error={createChild.error}
          onCancel={() => setInviteOpen(false)}
          onSubmit={(values) => {
            void createChild
              .mutateAsync(toChildBody(values))
              .then((patient) => {
                setInviteOpen(false);
                // Сразу в карту: врач завёл её, чтобы записать назначение, а не
                // чтобы вернуться в список.
                void navigate({
                  to: "/app/patients/$patientId/$view",
                  params: { patientId: patient.id, view: "profile" },
                });
              })
              .catch(() => null);
          }}
        />
      </FormSheet>
    </PageLayout>
  );
}

/**
 * Возраст в месяцах до двух лет и в годах дальше: до двух лет разница в месяцах
 * клинически значима, а «1 год» её стирает.
 */
function AgeCell({ months }: { months: number | null }) {
  const { t } = useTranslation("doctor");

  if (months === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span className="tabular-nums whitespace-nowrap">
      {months < 24
        ? t("age.months", { count: months })
        : t("age.years", { count: Math.floor(months / 12) })}
    </span>
  );
}
