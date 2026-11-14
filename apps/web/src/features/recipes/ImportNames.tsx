import { Badge, Button, Section } from "@ketocare/ui";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { NewProductSheet } from "../calculator/NewProductSheet";
import { ImportProductSearch } from "./ImportProductSearch";
import {
  useDecideName,
  type ImportDraft,
  type ImportName,
} from "./useRecipeImportDraft";

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
 *
 * Список — таблицей, строка на название: на сборнике в двести рецептов
 * названий десятки, и карточка на каждое превращала проверку в прокрутку.
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

  /**
   * Решение по названию из двух независимых частей: продукт — для строк с
   * массой, «не взвешивать» — для строк без неё. Меняя одну, вторую отправляем
   * как есть, иначе сервер прочёл бы её отсутствие как отмену.
   */
  function choose(name: ImportName, productId: string) {
    decide.mutate(
      { key: name.key, productId, leftOut: name.left_out },
      { onSuccess: () => setSearching(null) },
    );
  }

  function setLeftOut(name: ImportName, leftOut: boolean) {
    decide.mutate({
      key: name.key,
      productId:
        name.source === "manual" && name.product ? name.product.id : undefined,
      leftOut,
    });
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="pb-2 text-left text-card-title">
              {t("importDraft.names.todo", { count: waiting.length })}
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("importDraft.names.columns.name")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("importDraft.names.columns.suggested")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("importDraft.names.columns.other")}
                </th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((name) => (
                <Fragment key={name.key}>
                  <tr className="border-b border-border align-top last:border-b-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="font-medium">{name.name}</span>
                      <span className="block text-muted-foreground">
                        {name.hint &&
                          `${t("importDraft.names.hint", { name: name.hint })} · `}
                        {t("importDraft.names.inRecipes", {
                          count: name.recipes,
                        })}
                      </span>
                      {name.left_out && (
                        // Часть решения уже принята: строки без массы не
                        // взвешиваются. Название осталось в списке, потому
                        // что где-то у него масса написана.
                        <span className="block text-muted-foreground">
                          {t("importDraft.names.partlyLeftOut")}
                        </span>
                      )}
                    </th>
                    <td className="py-2 pr-3">
                      {name.candidates.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {name.candidates.map((candidate) => (
                            <Button
                              key={candidate.id}
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={decide.isPending}
                              onClick={() => choose(name, candidate.id)}
                            >
                              {candidate.name_ru}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("importDraft.names.noSuggestions")}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={searching === name.key}
                          onClick={() =>
                            setSearching(
                              searching === name.key ? null : name.key,
                            )
                          }
                        >
                          {t("importDraft.names.find")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setCreating(name)}
                        >
                          {t("importDraft.names.create")}
                        </Button>
                        {/* Только там, где есть строки без массы: написанную
                            массу общим решением не убрать. */}
                        {name.unweighed > 0 && !name.left_out && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={decide.isPending}
                            title={t("importDraft.names.leaveOutHint")}
                            onClick={() => setLeftOut(name, true)}
                          >
                            {t("importDraft.names.leaveOut")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {searching === name.key && (
                    <tr className="border-b border-border">
                      <td colSpan={3} className="py-2">
                        <ImportProductSearch
                          onPick={(productId) => choose(name, productId)}
                          onCancel={() => setSearching(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {settled.length > 0 && (
        // Решённое свёрнуто: проверяющему важно то, что осталось. Развернуть
        // стоит, чтобы поправить выбор, сделанный раньше или не им.
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            {t("importDraft.names.settled", { count: settled.length })}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0 text-sm">
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearching(name.key)}
                  >
                    {t("importDraft.names.change")}
                  </Button>
                  {name.left_out && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => setLeftOut(name, false)}
                    >
                      {t("importDraft.names.restore")}
                    </Button>
                  )}
                </div>
                {searching === name.key && (
                  <ImportProductSearch
                    onPick={(productId) => choose(name, productId)}
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
          if (creating !== null) choose(creating, product.id);
        }}
      />
    </Section>
  );
}
