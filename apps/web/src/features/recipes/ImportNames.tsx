import { Badge, Button, Section } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { NewProductSheet } from "../calculator/NewProductSheet";
import { ProductPicker } from "../calculator/ProductPicker";
import {
  useDecideName,
  type ImportDraft,
  type ImportName,
} from "./useRecipeImportDraft";

/** Из поиска ничего не исключается: одно название — один продукт. */
const NO_PRODUCTS: string[] = [];

/**
 * Названия продуктов из файла — каждое решается один раз (ADR-0079).
 *
 * Это первая и главная часть проверки: «масло слив.» стоит в сорока рецептах,
 * и решать его сорок раз значило бы вернуть человека к ручному вводу. Решение
 * по названию сервер применяет ко всем рецептам файла и запоминает для
 * следующих.
 *
 * Найденное поиском — только предложение. Продукт встаёт в рецепт после
 * щелчка: «сливки 10 %» вместо «сливки 33 %» — это другое кетосоотношение.
 */
export function ImportNames({ draft }: { draft: ImportDraft }) {
  const { t } = useTranslation("recipes");
  const decide = useDecideName(draft.id);
  // Название, у которого открыт поиск по справочнику: уточняемое или уже
  // сопоставленное, которое решили поменять.
  const [searching, setSearching] = useState<string | null>(null);
  const [creating, setCreating] = useState<ImportName | null>(null);

  const waiting = draft.names.filter((name) => name.state === "unresolved");
  const settled = draft.names.filter((name) => name.state !== "unresolved");

  function choose(key: string, productId: string) {
    decide.mutate({ key, productId }, { onSuccess: () => setSearching(null) });
  }

  if (draft.names.length === 0) return null;

  return (
    <Section title={t("importDraft.names.title")}>
      <p className="m-0 text-sm text-muted-foreground">
        {waiting.length === 0
          ? t("importDraft.names.allDone")
          : t("importDraft.names.intro")}
      </p>

      {decide.isError && (
        <FormError>
          {errorMessageOf(decide.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {waiting.length > 0 && (
        <>
          <h3 className="m-0 text-card-title">
            {t("importDraft.names.todo", { count: waiting.length })}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-field p-0">
            {waiting.map((name) => (
              <li
                key={name.key}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                <NameHeading name={name} />

                {name.candidates.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {t("importDraft.names.suggested")}
                    </span>
                    {name.candidates.map((candidate) => (
                      <Button
                        key={candidate.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => choose(name.key, candidate.id)}
                      >
                        {candidate.name_ru}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-muted-foreground">
                    {t("importDraft.names.noSuggestions")}
                  </p>
                )}

                {searching === name.key ? (
                  <NameSearch
                    onPick={(productId) => choose(name.key, productId)}
                    onCancel={() => setSearching(null)}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSearching(name.key)}
                    >
                      {t("importDraft.names.find")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCreating(name)}
                    >
                      {t("importDraft.names.create")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={decide.isPending}
                      title={t("importDraft.names.leaveOutHint")}
                      onClick={() =>
                        decide.mutate({ key: name.key, leftOut: true })
                      }
                    >
                      {t("importDraft.names.leaveOut")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {settled.length > 0 && (
        // Решённое свёрнуто: проверяющему важно то, что осталось. Развернуть
        // стоит, чтобы поправить выбор, сделанный раньше или не им.
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            {t("importDraft.names.settled", { count: settled.length })}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {settled.map((name) => (
              <li
                key={name.key}
                className="flex flex-col gap-2 border-b border-border pb-2 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{name.name}</span>
                  <span aria-hidden="true">→</span>
                  {name.product ? (
                    <>
                      <span>{name.product.name_ru}</span>
                      {name.source && (
                        <Badge variant="outline">
                          {t(`importDraft.names.source.${name.source}`)}
                        </Badge>
                      )}
                      {!name.product.counts_in_calculation && (
                        <Badge variant="secondary">
                          {t("importDraft.names.seasoning")}
                        </Badge>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("importDraft.names.leftOut")}
                    </span>
                  )}
                  {name.product ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSearching(name.key)}
                    >
                      {t("importDraft.names.change")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ key: name.key })}
                    >
                      {t("importDraft.names.restore")}
                    </Button>
                  )}
                </div>
                {searching === name.key && (
                  <NameSearch
                    onPick={(productId) => choose(name.key, productId)}
                    onCancel={() => setSearching(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <NewProductSheet
        open={creating !== null}
        // Форма начинается с русского названия: справочник ведётся по-русски,
        // а в файле оно могло быть на другом языке.
        name={creating?.hint ?? creating?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setCreating(null);
        }}
        onCreated={(product) => {
          if (creating !== null) choose(creating.key, product.id);
        }}
      />
    </Section>
  );
}

function NameHeading({ name }: { name: ImportName }) {
  const { t } = useTranslation("recipes");

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-medium">{name.name}</span>
      {name.hint && (
        <span className="text-sm text-muted-foreground">
          {t("importDraft.names.hint", { name: name.hint })}
        </span>
      )}
      <span className="text-sm text-muted-foreground">
        {t("importDraft.names.inRecipes", { count: name.recipes })}
      </span>
    </div>
  );
}

function NameSearch({
  onPick,
  onCancel,
}: {
  onPick: (productId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("recipes");

  return (
    <div className="flex flex-col gap-2">
      <ProductPicker
        excludeIds={NO_PRODUCTS}
        onPick={(product) => onPick(product.id)}
      />
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("importDraft.names.cancel")}
        </Button>
      </div>
    </div>
  );
}
