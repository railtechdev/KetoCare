import {
  AsyncSection,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FormSheet,
  formatGrams,
  formatKcal,
  formatNumber,
  formatWeight,
  formatDayMonth,
  formatRatio,
  parseDateInput,
  RatioBadge,
  Section,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, History, KeyRound, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { useDishReview } from "../dishes/useCustomDishes";
import { PatientViewLink } from "./PatientViewLink";
import { usePatientOverview } from "../patients/overview";
import { RecordWeight } from "./RecordWeight";
import { PrescriptionConfirm } from "./PrescriptionConfirm";
import { EnergyHint } from "./EnergyHint";
import { PrescriptionForm } from "./PrescriptionForm";
import { formatIsoDate, formatTimestamp } from "./dates";
import { useCreatePrescription } from "./doctorMutations";
import { activePrescriptionOf, usePrescriptionHistory } from "./doctorQueries";
import {
  prescriptionFormValues,
  toPrescriptionBody,
  type PrescriptionFormValues,
} from "./prescriptionSchema";
import { LinesSkeleton, TableSkeleton } from "./skeletons";
import { PrescriptionFacts } from "./PrescriptionFacts";
import { canWritePrescriptions, type PrescriptionVersion } from "./types";
import { queryState } from "../../lib/queryState";
import { useSectionItem } from "../../routes/useSectionTab";
import { ACCESS_CODE_ITEM, PRESCRIPTION_HISTORY_ITEM } from "./patientViews";

/**
 * Вкладка назначения: новая версия и история версий (раздел 8.3 ТЗ).
 *
 * Форма — во всю ширину, история — панелью по кнопке (аудит продукта
 * 12.11.2026): рядом с историей форма занимала полтора экрана, и «Сохранить»
 * уходила за нижний край.
 *
 * Назначения append-only: правки существующей версии нет ни на сервере, ни здесь
 * — изменение назначения создаёт новую строку (правило 4 CLAUDE.md).
 */
export function PrescriptionTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();

  const history = usePrescriptionHistory(patientId);
  const overview = usePatientOverview(patientId);
  const lastWeight = overview.data?.last_weight;
  const create = useCreatePrescription(patientId);

  // Идентификатор созданной версии, а не её номер: номер берётся из
  // обновлённой истории, иначе пришлось бы считать «было плюс один», а пока
  // врач заполнял форму, версию мог создать коллега.
  const [createdId, setCreatedId] = useState<string | null>(null);
  // Set once a version is saved: only then is "your dishes no longer fit" news.
  const [savedThisVisit, setSavedThisVisit] = useState(false);
  const review = useDishReview(savedThisVisit ? patientId : null);

  // Значения, ждущие подтверждения врача (ответ клиники на вопрос 5). Пока
  // окно открыто, ничего не отправлено: назначение append-only, и отменить
  // записанное можно только новой версией.
  const [pendingValues, setPendingValues] =
    useState<PrescriptionFormValues | null>(null);

  const versions = useMemo(() => history.data?.versions ?? [], [history.data]);
  const active = activePrescriptionOf(history.data);
  // Правка строится от того, что показано как действующее (`/overview`,
  // ADR-0078), а не от последней записанной версии: та бывает будущей, и врач
  // правил бы не то, что видит (ревью безопасности 18.11.2026).
  const inForce = overview.data?.prescription ?? null;
  const upcoming = overview.data?.upcoming_prescription ?? null;
  const base = inForce ?? active;
  const savedVersion =
    createdId === null
      ? null
      : (versions.find((entry) => entry.prescription.id === createdId)
          ?.version ?? null);

  // Успех — тост, а не зелёная плашка в потоке страницы (правило П16 канона).
  // Ждём номер версии из обновлённой истории: он и есть содержание сообщения.
  useEffect(() => {
    if (savedVersion === null) return;

    toast.success(t("prescription.saved.title", { version: savedVersion }), {
      description: t("prescription.saved.body"),
    });
    setCreatedId(null);
    setSavedThisVisit(true);
  }, [savedVersion, t]);

  const canWrite = canWritePrescriptions(session?.role);
  // Действующее назначение показывается на чтение, поля открывает кнопка
  // «Изменить назначение» (аудит интерфейса 18.11.2026, Р2): форма, открытая
  // всегда, позволяла поменять число случайно — и такая версия уходила семье.
  const [editing, setEditing] = useState(false);
  const hasVersions = (history.data?.total ?? 0) > 0;
  const formOpen = canWrite && (editing || !hasVersions);

  const columns = useMemo<ColumnDef<PrescriptionVersion, unknown>[]>(
    () => [
      {
        accessorKey: "version",
        header: t("prescription.columns.version"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.version}</span>
        ),
      },
      {
        id: "effectiveFrom",
        accessorFn: (row) => row.prescription.effective_from,
        header: t("prescription.columns.effectiveFrom"),
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatIsoDate(row.original.prescription.effective_from) ?? "—"}
          </span>
        ),
      },
      {
        id: "ratio",
        accessorFn: (row) => row.prescription.ratio,
        header: t("fields.ratio"),
        cell: ({ row }) => (
          <RatioBadge ratio={row.original.prescription.ratio} />
        ),
      },
      {
        id: "kcal",
        accessorFn: (row) => row.prescription.kcal_per_day,
        header: t("fields.kcal"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatKcal(row.original.prescription.kcal_per_day)}
          </span>
        ),
      },
      {
        id: "protein",
        accessorFn: (row) => row.prescription.protein_g,
        header: t("fields.protein"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatGrams(row.original.prescription.protein_g)}
          </span>
        ),
      },
      {
        id: "carbsLimit",
        accessorFn: (row) => row.prescription.carbs_limit_g,
        header: t("fields.carbsLimit"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatGrams(row.original.prescription.carbs_limit_g)}
          </span>
        ),
      },
      {
        id: "meals",
        accessorFn: (row) => row.prescription.meals_per_day,
        header: t("fields.meals"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.prescription.meals_per_day}
          </span>
        ),
      },
      {
        id: "fluid",
        accessorFn: (row) => row.prescription.fluid_ml_per_day ?? null,
        header: t("fields.fluid"),
        cell: ({ row }) => {
          const fluid = row.original.prescription.fluid_ml_per_day;
          return (
            <span className="tabular-nums">
              {fluid == null ? "—" : formatNumber(fluid, 0)}
            </span>
          );
        },
      },
      {
        id: "createdAt",
        accessorFn: (row) => row.prescription.created_at,
        header: t("prescription.columns.createdAt"),
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatTimestamp(row.original.prescription.created_at) ?? "—"}
          </span>
        ),
      },
    ],
    [t],
  );

  const [item, setItem] = useSectionItem();
  const historyOpen = item === PRESCRIPTION_HISTORY_ITEM;
  // Следующий шаг после записи назначения — код семье (аудит продукта
  // 12.11.2026): без семьи назначение некому выполнять. Только пока семья не
  // подключена: подключённой код уже не нужен.
  const familyNotConnected = overview.data?.family_activated === false;

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-center gap-field">
        <span>
          {lastWeight == null
            ? t("prescription.noWeight")
            : t("prescription.weightOn", {
                value: formatWeight(lastWeight.weight_kg),
                date: formatTimestamp(lastWeight.occurred_at) ?? "",
              })}
        </span>
        <RecordWeight patientId={patientId} />
        <div className="flex flex-wrap items-center gap-field ml-auto">
          {/* Печать назначения — в шапке карты («Печать: назначение и меню
              недели», FamilyPrintButton): вторая кнопка здесь печатала тот же
              лист без меню и читалась как дубль (аудит интерфейса 18.11.2026). */}
          {/* История — по кнопке, а не колонкой рядом с формой: колонка
              отнимала у формы половину ширины и выталкивала «Сохранить» за
              край экрана. Панель — в адресе (`?item=history`, П1). */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setItem(PRESCRIPTION_HISTORY_ITEM)}
          >
            <History aria-hidden="true" />
            {t("prescription.historyTitle")}
          </Button>
        </div>
      </div>

      {savedThisVisit && familyNotConnected && (
        <Section
          title={t("prescription.nextStep.title")}
          tone="accent"
          density="compact"
        >
          <div className="flex flex-wrap items-center gap-field">
            <p className="m-0">{t("prescription.nextStep.body")}</p>
            <Button asChild>
              <PatientViewLink
                patientId={patientId}
                view="profile"
                item={ACCESS_CODE_ITEM}
              >
                <KeyRound aria-hidden="true" />
                {t("prescription.nextStep.action")}
              </PatientViewLink>
            </Button>
          </div>
        </Section>
      )}

      {(review.data?.off_target.length ?? 0) > 0 && (
        <p className="m-0">
          {t("prescription.dishesOffTarget", {
            count: review.data?.off_target.length,
          })}{" "}
          <PatientViewLink
            patientId={patientId}
            view="dishes"
            className="font-medium underline"
          >
            {t("prescription.dishesOffTargetLink")}
          </PatientViewLink>
        </p>
      )}

      <Section
        title={
          !hasVersions
            ? // Первое назначение не «изменяется»: менять ещё нечего.
              t("prescription.formTitleFirst")
            : formOpen
              ? t("prescription.formTitle")
              : t("prescription.currentTitle")
        }
      >
        {/* Форма — только после истории: новая версия строится от
            действующей. Пока история не пришла (или не пришла вовсе),
            форма открывалась пустой как «первое назначение», и врач мог
            записать версию, не видя действующей. */}
        {history.data === undefined ? (
          history.isError ? (
            <ErrorState
              title={t("prescription.loadError")}
              description={
                errorMessageOf(history.error) ?? t("common:errors.unexpected")
              }
              retryLabel={t("common:actions.retry")}
              onRetry={() => void history.refetch()}
            />
          ) : (
            <p className="m-0 text-sm text-muted-foreground" role="status">
              {t("prescription.formWaiting")}
            </p>
          )
        ) : formOpen ? (
          <>
            {upcoming !== null && hasVersions && (
              <p className="m-0" role="note">
                {t("prescription.upcomingReplaced", {
                  date: formatIsoDate(upcoming.effective_from) ?? "",
                  ratio: formatRatio(upcoming.ratio),
                  kcal: formatKcal(upcoming.kcal_per_day),
                })}
              </p>
            )}
            <PrescriptionForm
              // Ключ по идентификатору действующей версии: после сохранения
              // форма пересоздаётся уже с новыми значениями, иначе врач увидел
              // бы в ней предыдущее назначение.
              key={base?.id ?? "first"}
              defaultValues={prescriptionFormValues(base, new Date())}
              pending={create.isPending}
              error={create.error}
              onSubmit={setPendingValues}
              // Отказаться от правки можно всегда, кроме первого назначения:
              // там закрывать форму не во что.
              cancelLabel={
                hasVersions ? t("prescription.cancelEdit") : undefined
              }
              onCancel={
                hasVersions
                  ? () => {
                      create.reset();
                      setEditing(false);
                    }
                  : undefined
              }
              kcalHint={(apply) => (
                <EnergyHint patientId={patientId} onApply={apply} />
              )}
            />
          </>
        ) : hasVersions ? (
          <CurrentPrescription
            patientId={patientId}
            onEdit={canWrite ? () => setEditing(true) : undefined}
          />
        ) : (
          <EmptyState icon={ClipboardList} title={t("prescription.empty")} />
        )}
        {canWrite && (
          <ConfirmDialog
            open={pendingValues !== null}
            onOpenChange={(open) => {
              if (!open) setPendingValues(null);
            }}
            title={
              // «Первое» — только по ответу сервера, что версий нет вовсе.
              history.data?.total === 0
                ? t("prescription.confirm.titleFirst")
                : t("prescription.confirm.title")
            }
            description={t("prescription.confirm.description")}
            confirmLabel={t("prescription.confirm.action")}
            cancelLabel={t("prescription.confirm.cancel")}
            destructive={false}
            onConfirm={() => {
              if (pendingValues === null) return;
              create.mutate(toPrescriptionBody(pendingValues), {
                onSuccess: (created) => {
                  setCreatedId(created.id);
                  setEditing(false);
                },
              });
              setPendingValues(null);
            }}
          >
            {pendingValues !== null && (
              <PrescriptionConfirm values={pendingValues} previous={base} />
            )}
          </ConfirmDialog>
        )}
      </Section>

      <FormSheet
        closeLabel={t("common:actions.close")}
        open={historyOpen}
        onOpenChange={(open) =>
          setItem(open ? PRESCRIPTION_HISTORY_ITEM : undefined)
        }
        title={t("prescription.historyTitle")}
      >
        {/* Правило пяти состояний — общим компонентом (П15): рукописная
            цепочка прятала уже загруженную историю назначений за красным
            блоком при неудачном фоновом обновлении. */}
        <AsyncSection
          {...queryState(history)}
          skeleton={
            <TableSkeleton label={t("prescription.loading")} rows={3} />
          }
          error={
            history.isError
              ? {
                  title: t("prescription.loadError"),
                  description:
                    errorMessageOf(history.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void history.refetch()}
          isEmpty={history.data === undefined}
          empty={null}
        >
          {history.data !== undefined && (
            <DataTable
              columns={columns}
              data={versions}
              caption={t("prescription.caption")}
              emptyState={
                <EmptyState
                  icon={ClipboardList}
                  title={t("prescription.empty")}
                />
              }
              labels={{
                previousPage: t("table.previousPage"),
                nextPage: t("table.nextPage"),
                pageStatus: (page, total) =>
                  t("table.pageStatus", { page, total }),
              }}
            />
          )}
        </AsyncSection>
      </FormSheet>
    </div>
  );
}

/**
 * The prescription in force today, read-only, and the one queued for a later
 * date.
 *
 * Which version is in force decides the server (`/overview`, ADR-0078): the
 * newest saved version may start tomorrow, and calling it «current» here would
 * contradict the card overview.
 */
function CurrentPrescription({
  patientId,
  onEdit,
}: {
  patientId: string;
  /** Absent for a role that may only read the prescription. */
  onEdit?: () => void;
}) {
  const { t } = useTranslation("doctor");
  const overview = usePatientOverview(patientId);
  const inForce = overview.data?.prescription ?? null;
  const upcoming = overview.data?.upcoming_prescription ?? null;
  const upcomingStarts =
    upcoming === null ? null : parseDateInput(upcoming.effective_from);

  return (
    <div className="flex flex-col gap-field">
      <AsyncSection
        {...queryState(overview)}
        skeleton={<LinesSkeleton label={t("prescription.loading")} lines={4} />}
        error={
          overview.isError
            ? {
                title: t("prescription.loadError"),
                description:
                  errorMessageOf(overview.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void overview.refetch()}
        isEmpty={overview.data === undefined}
        empty={null}
      >
        {overview.data !== undefined && (
          <>
            {inForce === null ? (
              <p className="m-0">{t("prescription.notYetInForce")}</p>
            ) : (
              <PrescriptionFacts prescription={inForce} />
            )}
            {upcoming !== null && upcomingStarts !== null && (
              <p className="m-0 text-sm">
                {t("prescription.upcoming", {
                  date: formatDayMonth(upcomingStarts),
                  ratio: formatRatio(upcoming.ratio),
                  kcal: formatKcal(upcoming.kcal_per_day),
                })}
              </p>
            )}
          </>
        )}
      </AsyncSection>
      {/* Кнопка — только когда действующее назначение на экране: иначе при
          сбое сводки форма открылась бы, не показав его. */}
      {onEdit !== undefined && overview.data !== undefined && (
        <Button type="button" className="self-start" onClick={onEdit}>
          <Pencil aria-hidden="true" />
          {t("prescription.edit")}
        </Button>
      )}
    </div>
  );
}
