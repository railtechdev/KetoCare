import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
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
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>
        <p className="m-0 mt-1 text-muted">{t("children.intro")}</p>
      </header>

      {patients.isPending && (
        <p role="status" className="m-0 text-muted">
          {t("children.loading")}
        </p>
      )}

      {patients.error !== null && (
        <FormError>
          {errorMessageOf(patients.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {!patients.isPending && children.length === 0 && (
        <p className="m-0 text-muted">{t("children.empty")}</p>
      )}

      {children.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {children.map((child) => (
            <li
              key={child.id}
              className="flex flex-wrap items-center gap-4 rounded-kc border border-line p-4"
            >
              <span className="font-semibold">{child.full_name}</span>
              <span className="text-sm text-muted">
                {t("children.birthDate", { date: child.birth_date })}
              </span>
              <span className="text-sm text-muted">
                {child.height_cm === null
                  ? t("children.noHeight")
                  : t("children.height", { value: child.height_cm })}
              </span>
              <span className="text-sm text-muted">
                {child.allergies.length === 0
                  ? t("children.noAllergies")
                  : t("children.allergies", {
                      list: child.allergies.join(", "),
                    })}
              </span>
              <button
                type="button"
                onClick={() => setView({ kind: "edit", child })}
                className="ml-auto min-h-touch rounded-lg border border-line px-4 text-ink"
              >
                {t("children.edit")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <button
          type="button"
          onClick={() => setView({ kind: "add" })}
          className="min-h-touch rounded-lg bg-accent px-4 font-semibold text-on-accent"
        >
          {t("child.add")}
        </button>
      </div>
    </section>
  );
}

function AddChild({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("settings");
  const create = useCreateChildMutation();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="m-0 text-xl font-semibold">{t("child.addTitle")}</h1>
      <ChildForm
        child={null}
        pending={create.isPending}
        error={create.error}
        onCancel={onDone}
        onSubmit={(values) => {
          create.mutate(toChildBody(values), { onSuccess: onDone });
        }}
      />
    </section>
  );
}

function EditChild({ child, onDone }: { child: Patient; onDone: () => void }) {
  const { t } = useTranslation("settings");
  const update = useUpdateChildMutation(child.id);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="m-0 text-xl font-semibold">{t("child.editTitle")}</h1>
      <ChildForm
        child={child}
        pending={update.isPending}
        error={update.error}
        onCancel={onDone}
        onSubmit={(values) => {
          update.mutate(toChildUpdateBody(values), { onSuccess: onDone });
        }}
      />
    </section>
  );
}
