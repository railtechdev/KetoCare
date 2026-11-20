import {
  AsyncSection,
  Button,
  hasSeizureTree,
  seizureChildren,
  seizureNodeByRef,
  unknownSeizureType,
} from "@ketocare/ui";
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import type { DictionaryStatus, NamedOption } from "./useDiary";

/**
 * Уровень выбора: прошлые типы ребёнка, группы классификации или подтипы
 * группы с номером `ref`. Уровни лежат стопкой у формы, и «Назад» Telegram
 * снимает верхний — как «Назад» в боте (ADR-0076).
 */
export type SeizurePickerLevel =
  { at: "first" } | { at: "groups" } | { at: "node"; ref: string };

/**
 * Выбор типа приступа — в том же порядке, что в боте (аудит Mini App, Д3).
 *
 * Прежде форма требовала выбрать тип из двадцати пяти терминов одним
 * списком. Теперь первым экраном — типы прошлых записей ЭТОГО ребёнка (у
 * ребёнка на терапии приступы обычно одних и тех же типов), «Другой тип» и
 * «Не знаю»; «Другой тип» ведёт по группам классификации к подтипу. Группу
 * можно выбрать саму («точнее не знаю»): родитель может знать группу и не
 * знать подтипа, и выбирать за него подтип нельзя.
 *
 * Выведенные типы (ADR-0050) здесь не предлагаются — их отфильтровывает
 * вызывающий; запись, которая на таком типе стоит, показывает его по-прежнему.
 * Справочник без номеров ILAE — плоский список, как у бота.
 *
 * Названия типов — клинический текст: по-русски и на узбекском экране
 * (`name_ru`, ADR-0052).
 */
export function SeizureTypePicker({
  level,
  types,
  dictionary,
  recent,
  onPick,
  onOpen,
}: {
  level: SeizurePickerLevel;
  /** Действующие типы справочника, в его порядке. */
  types: readonly NamedOption[];
  /** Загрузка справочника: пустой `types` бывает и отказом, и ожиданием связи. */
  dictionary: DictionaryStatus;
  /** Типы прошлых приступов ребёнка, свежие первыми; `null` — ответ ещё идёт. */
  recent: readonly string[] | null;
  onPick: (typeId: string) => void;
  onOpen: (level: SeizurePickerLevel) => void;
}) {
  const { t } = useTranslation();
  // Первый экран строится по прошлым типам один раз — каким его увидели.
  // Ответ, пришедший позже, перерисовал бы группы в прошлые типы под пальцем,
  // и нажатие на «Фокальный приступ» записало бы чужой тип (Д3). Поэтому
  // первый экран ждёт ответа, а после показа список не меняется.
  const [shownRecent, setShownRecent] = useState(recent);
  if (shownRecent === null && recent !== null) setShownRecent(recent);
  const waitingForRecent = level.at === "first" && shownRecent === null;

  return (
    <AsyncSection
      loading={dictionary.pending || waitingForRecent}
      skeleton={
        <p role="status" className="m-0 text-muted-foreground">
          {t("actions.loading")}
        </p>
      }
      waiting={dictionary.paused ? t("errors.waitingForNetwork") : null}
      // Отказ — словами и с повтором, а не вечной «загрузкой»: без справочника
      // записать приступ нельзя, и человек должен знать почему.
      error={
        dictionary.error != null && types.length === 0
          ? {
              title: t("diary.seizurePicker.loadFailed"),
              description:
                errorMessageOf(dictionary.error) ?? t("home.loadErrorHint"),
            }
          : null
      }
      retryLabel={t("actions.retry")}
      onRetry={dictionary.retry}
      isEmpty={types.length === 0 || waitingForRecent}
      empty={
        <p role="status" className="m-0 text-muted-foreground">
          {t("diary.seizurePicker.empty")}
        </p>
      }
    >
      <Levels
        level={level}
        types={types}
        recent={shownRecent ?? []}
        onPick={onPick}
        onOpen={onOpen}
      />
    </AsyncSection>
  );
}

function Levels({
  level,
  types,
  recent,
  onPick,
  onOpen,
}: {
  level: SeizurePickerLevel;
  types: readonly NamedOption[];
  recent: readonly string[];
  onPick: (typeId: string) => void;
  onOpen: (level: SeizurePickerLevel) => void;
}) {
  const { t } = useTranslation();
  const recentTypes = recent
    .map((id) => types.find((type) => type.id === id))
    .filter((type): type is NamedOption => type !== undefined);
  const unknown = unknownSeizureType(types);
  const tree = hasSeizureTree(types);

  const unknownButton = unknown !== null && (
    <Choice onClick={() => onPick(unknown.id)}>
      {t("diary.seizurePicker.unknown")}
    </Choice>
  );

  if (level.at === "first" && recentTypes.length > 0) {
    return (
      <Level title={t("diary.seizurePicker.ask")}>
        {recentTypes.map((type) => (
          <Choice key={type.id} onClick={() => onPick(type.id)}>
            {type.name}
          </Choice>
        ))}
        <Choice onClick={() => onOpen({ at: "groups" })} opens>
          {t("diary.seizurePicker.other")}
        </Choice>
        {unknownButton}
      </Level>
    );
  }

  if (level.at === "node") {
    const group = seizureNodeByRef(types, level.ref);
    if (group !== null) {
      return (
        <Level title={t("diary.seizurePicker.subtype", { group: group.name })}>
          <Choice onClick={() => onPick(group.id)}>
            {t("diary.seizurePicker.groupItself", { name: group.name })}
          </Choice>
          {seizureChildren(types, level.ref).map(({ node, hasChildren }) => (
            <Choice
              key={node.id}
              opens={hasChildren}
              onClick={() =>
                hasChildren && node.ilaeRef
                  ? onOpen({ at: "node", ref: node.ilaeRef })
                  : onPick(node.id)
              }
            >
              {node.name}
            </Choice>
          ))}
        </Level>
      );
    }
  }

  // Справочник без номеров классификации — одним списком, как у бота.
  if (!tree) {
    return (
      <Level title={t("diary.seizurePicker.ask")}>
        {types.map((type) => (
          <Choice key={type.id} onClick={() => onPick(type.id)}>
            {type.name}
          </Choice>
        ))}
      </Level>
    );
  }

  // Группы: верхний уровень без «Неклассифицированного» — он и есть «Не знаю».
  return (
    <Level title={t("diary.seizurePicker.group")}>
      {seizureChildren(types, null)
        .filter(({ node }) => node.id !== unknown?.id)
        .map(({ node, hasChildren }) => (
          <Choice
            key={node.id}
            opens={hasChildren}
            onClick={() =>
              hasChildren && node.ilaeRef
                ? onOpen({ at: "node", ref: node.ilaeRef })
                : onPick(node.id)
            }
          >
            {node.name}
          </Choice>
        ))}
      {unknownButton}
    </Level>
  );
}

function Level({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-field">
      <p id={id} className="m-0 font-semibold">
        {title}
      </p>
      <ul className="m-0 flex list-none flex-col gap-field p-0">{children}</ul>
    </div>
  );
}

/** Крупная кнопка варианта; `opens` — ведёт на следующий уровень. */
function Choice({
  children,
  onClick,
  opens = false,
}: {
  children: ReactNode;
  onClick: () => void;
  opens?: boolean;
}) {
  return (
    <li>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-touch w-full justify-between gap-field py-2 text-left whitespace-normal"
        onClick={onClick}
      >
        <span>{children}</span>
        {opens && (
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
        )}
      </Button>
    </li>
  );
}
