import {
  ActionReason,
  Button,
  CALC_GRAMS_MAX,
  RECALC_DELAY_MS,
  canRetry,
  Section,
  Separator,
  WarningBanner,
  exceedsCalcGrams,
  mealTargetsFrom,
} from "@ketocare/ui";
import { onlineManager } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { useSectionItem } from "../../routes/useSectionTab";
import { useIncomingComposition } from "./incomingDish";
import { parseIncoming } from "./incomingItem";
import { usePatientOverview } from "../patients/overview";
import { DishResultView, type DishView } from "./DishResultView";
import { HandOffToPatient } from "./HandOffToPatient";
import { DishRows } from "./DishRows";
import { ProductPicker } from "./ProductPicker";
import { SaveDishForm } from "./SaveDishForm";
import type { DishRow } from "./types";
import { useProduct } from "./useProducts";
import {
  useScaleMutation,
  useSolveMutation,
  useVerifyMutation,
  type TargetsInput,
} from "./useCalcMutations";

/**
 * Калькулятор: один экран, три функции раздела 9 ТЗ.
 *
 * **Вкладок больше нет, и это главное изменение.** Проверка, подбор и пересчёт
 * были тремя режимами — тремя РАЗНЫМИ экранами с разным поведением, — и
 * последовательность работы об это ломалась. Экран открывался на «Проверить»,
 * при том что главный вопрос и врача («выполнимо ли соотношение на этих
 * продуктах»), и родителя («сколько положить, чтобы вышло») — это подбор, а он
 * лежал за второй вкладкой. Наше единственное преимущество перед кабинетом, к
 * которому привыкла клиника (`docs/AUDIT_KDC.md`, там граммовку доводят
 * стрелками вручную), было спрятано.
 *
 * Теперь проверка — не режим, а постоянное состояние экрана: числа
 * пересчитываются по мере правки. Подбор и пересчёт — действия над составом:
 * они его ПЕРЕЗАПИСЫВАЮТ, поэтому остаются кнопками, а не считаются по ходу
 * набора. Разбор — ADR-0028.
 *
 * **Цель стоит над фактом, и она не выдумывается.** Раньше вердикт «блюдо не
 * сходится с целью» стоял на 318 px ВЫШЕ самой цели, а калорийность приёма была
 * зашитой в экране четырёхсоткой, подписанной как «задаётся вами». Теперь цель
 * приходит из назначения ребёнка вместе с арифметикой, по которой посчитана, а
 * без назначения её просто нет — и сравнивать тогда не с чем.
 *
 * Ребёнок необязателен: «выйдет ли 4:1 на этих продуктах» — вопрос о продуктах
 * (ADR-0027).
 */
export function CalculatorPage({ patientId }: { patientId?: string }) {
  const { t } = useTranslation("calculator");

  return (
    <PageLayout title={t("title")} intro={t("intro")} width="form">
      <CalculatorView patientId={patientId} />
    </PageLayout>
  );
}

/**
 * Тело калькулятора без оболочки экрана.
 *
 * Оболочку ставит вызывающий: у раздела кабинета это `CalculatorPage` выше, у
 * карты пациента — её собственный `PageLayout` с названием раздела. Вложить
 * `PageLayout` сюда нельзя: в карте заголовок уже есть, и второй дал бы `h1`
 * внутри `h1` — ровно так «Калькулятор» и напечатался в карте дважды. Тем же
 * устроен отчёт (`ReportsView`).
 */
export function CalculatorView({ patientId }: { patientId?: string }) {
  const { t } = useTranslation("calculator");

  const [rows, setRows] = useState<DishRow[]>([]);

  // Продукт, пришедший из справочника (`?item=<id>`). Справочник знает только
  // идентификатор, состав на 100 г нужно дочитать.
  const [incomingId, setIncomingId] = useSectionItem();
  const incoming = parseIncoming(incomingId);
  const incomingProduct = useProduct(
    incoming?.kind === "product" ? incoming.id : undefined,
  );
  // Готовое блюдо: рецепт или своя раскладка — приходит из карточки рецепта и
  // из списка блюд ребёнка.
  const incomingDish = useIncomingComposition(incoming, patientId);

  /**
   * Цель расчёта. `null` в каждой половине — «не задано».
   *
   * Двумя числами, а не одним объектом с умолчаниями: цель существует, только
   * когда названы обе половины. Объект с подставленными значениями невозможно
   * отличить от заполненного человеком — именно так и появилась четырёхсотка,
   * которую никто не вводил, но против которой выносился вердикт.
   */
  const [ratio, setRatio] = useState<number | null>(null);
  const [kcal, setKcal] = useState<number | null>(null);
  const [proteinMin, setProteinMin] = useState<number | null>(null);
  const [carbsMax, setCarbsMax] = useState<number | null>(null);
  const [factor, setFactor] = useState(2);

  const overview = usePatientOverview(patientId ?? null);
  const prescription = overview.data?.prescription ?? null;
  const suggested = useMemo(
    () => mealTargetsFrom(prescription),
    [prescription],
  );

  // Правка человека важнее назначения: он мог считать блюдо под другую цель
  // осознанно, и подставлять назначение поверх введённого — терять его ввод.
  const touched = useRef(false);

  useEffect(() => {
    if (suggested === null || touched.current) return;
    setRatio((current) => (current === null ? suggested.ratio : current));
    setKcal((current) => (current === null ? suggested.kcal : current));
  }, [suggested]);

  /**
   * Собранная цель. `useMemo` здесь не оптимизация, а условие правильности:
   * задержка сравнивает значения по ссылке, и цель, пересобранная на каждом
   * рендере, делала расчёт вечно «устаревшим» — вердикт не показывался никогда,
   * а проверка уходила на сервер по кругу.
   */
  const targets: TargetsInput | null = useMemo(
    () =>
      ratio !== null && kcal !== null
        ? { ratio, kcal, proteinMin, carbsMax }
        : null,
    [ratio, kcal, proteinMin, carbsMax],
  );

  // Какое блюдо уже разложено на экране. Ссылка из адреса НЕ снимается: она
  // описывает, что открыто, и после F5 состав должен вернуться. А вот применять
  // её повторно нельзя — правки граммовки затирались бы исходным составом.
  const appliedDish = useRef<string | null>(null);

  useEffect(() => {
    const composition = incomingDish.rows;
    if (composition === null || composition.length === 0) return;
    if (incoming === null || appliedDish.current === incomingId) return;

    appliedDish.current = incomingId ?? null;
    // Состав блюда ЗАМЕЩАЕТ набранный: человек пришёл пересчитать конкретное
    // блюдо, а не дополнить им то, что было на экране.
    setRows(composition);
  }, [incomingDish.rows, incoming, incomingId]);

  useEffect(() => {
    const product = incomingProduct.data;
    if (product === undefined) return;

    // Параметр снимается сразу: он описывает не состояние экрана, а разовый
    // приход из справочника. Оставленный в адресе, он добавлял бы продукт
    // заново после каждой перезагрузки.
    setIncomingId(undefined);
    setRows((current) =>
      current.some((row) => row.product.id === product.id)
        ? current
        : [...current, { product, grams: 50 }],
    );
  }, [incomingProduct.data, setIncomingId]);

  const verify = useVerifyMutation();
  const solve = useSolveMutation();
  const scale = useScaleMutation();

  /**
   * Проверка идёт сама по мере правки состава и цели.
   *
   * Она ничего не перезаписывает, поэтому кнопки у неё нет: кнопка обещала бы
   * действие, которое уже произошло (правило П3 канона). Исключение — «Повторить»
   * после сбоя: без него экран оставался тупиком, из которого выводила только
   * фиктивная правка состава.
   */
  const debouncedRows = useDebouncedValue(rows, RECALC_DELAY_MS);
  const debouncedTargets = useDebouncedValue(targets, RECALC_DELAY_MS);
  const verifyMutate = verify.mutate;
  const verifyReset = verify.reset;

  // Вход проверки — один на автоматический запуск и на «Повторить»: разойдись
  // они, повтор проверял бы не то, что на экране, а разрешение на сохранение
  // сверяется именно с этим массивом состава.
  const verifyInput = useMemo(
    () => ({
      rows: debouncedRows,
      targets: debouncedTargets ?? undefined,
      patientId,
    }),
    [debouncedRows, debouncedTargets, patientId],
  );

  /**
   * Запуск проверки — один на автоматический запуск и на «Повторить»: оба не
   * отправляют пустой состав и массу тяжелее предела.
   */
  const runVerify = useCallback((): void => {
    if (verifyInput.rows.length === 0) {
      // Пустой состав не считают — но и числа прежнего блюда на экране не
      // оставляют: убрав последний продукт, человек видел его калорийность,
      // соотношение и предложение сохранить блюдо, которого больше нет.
      // Результат мутации сам не пропадает: он живёт, пока его не сбросят.
      verifyReset();
      return;
    }
    if (verifyInput.rows.some((row) => exceedsCalcGrams(row.grams))) {
      // Массу тяжелее предела сервер не примет, и на месте показателей встал
      // бы общий отказ без слова о поле. Причина уже названа у самого поля и
      // у кнопки пересчёта; числа прежнего состава снимаются, как у пустого:
      // они о блюде, которого на экране больше нет.
      verifyReset();
      return;
    }
    verifyMutate(verifyInput);
  }, [verifyInput, verifyMutate, verifyReset]);

  useEffect(() => {
    runVerify();
  }, [runVerify]);

  /**
   * Массы, посчитанные сервером, уезжают прямо в состав.
   *
   * И подбор, и пересчёт порций перезаписывают граммовку — состав остаётся
   * единственным, что на экране считается вводом. Пока пересчёт показывал
   * новые массы отдельным списком, а старые оставлял в полях, в сохранение
   * уходили старые: родитель, сохранивший «двойную порцию», получал блюдо с
   * одинарной раскладкой.
   */
  const solvedItems = solve.data?.dish.items;
  const scaledItems = scale.data?.dish.items;
  const resultItems = solvedItems ?? scaledItems;

  // Перенос — во время рендера, а не в эффекте. Обновление из пассивного
  // эффекта React откладывает в отдельную задачу, и между двумя коммитами
  // «Сохранить» и «Передать» были открыты со старыми граммами: ответ подбора
  // уже пришёл (ожидание снято), а проверка ещё относилась к прежнему составу.
  // Клик или Enter в это окно отправляли в блюда ребёнка граммы до подбора.
  const [appliedItems, setAppliedItems] = useState(resultItems);
  if (resultItems !== appliedItems) {
    setAppliedItems(resultItems);
    if (resultItems !== undefined) {
      const grams = new Map(
        resultItems.map((item) => [item.product_id, item.grams]),
      );
      // Ни одна масса не изменилась — прежний массив: новый, пусть и с теми же
      // числами, запускал бы лишнюю проверку и держал «Сохранить» ещё на неё.
      setRows((current) => {
        let changed = false;
        const next = current.map((row) => {
          const solved = grams.get(row.product.id);
          if (solved === undefined || solved === row.grams) return row;
          changed = true;
          return { ...row, grams: solved };
        });
        return changed ? next : current;
      });
    }
  }

  // Исключения приходят от сервера: сопоставить состав с тем, что ребёнку
  // нельзя, может только он — в браузере нет ни аллергий, ни каталога.
  const excluded = verify.data?.excluded ?? [];
  // Подбор не предупреждает об исключённом, а вычёркивает его со входа, и
  // сказать об этом больше негде: своего блока у результата подбора нет —
  // массы уезжают прямо в состав.
  const solveExcluded = solve.data?.excluded ?? [];
  const dish: DishView | null = verify.data?.dish ?? null;

  // Вклад каждой позиции — из того же ответа, что и итог блюда: сумма
  // вкладов и есть итог, ядро считает их одной арифметикой.
  const contributions = useMemo(
    () =>
      new Map(
        (verify.data?.dish.items ?? []).map((item) => [item.product_id, item]),
      ),
    [verify.data],
  );

  /**
   * Показанный результат посчитан не по тому, что сейчас в полях.
   *
   * Число на экране остаётся: гасить его на каждое нажатие — значит очищать тот
   * самый экран, по которому человек сверяется. А вот вердикт снимается.
   * Зелёный значок «в допуске», посчитанный при прежней цели, рядом с новым
   * числом — не устаревшая выдача, а неверное утверждение: по нему готовят еду
   * ребёнку.
   */
  const staleInput = rows !== debouncedRows || targets !== debouncedTargets;
  const stale = staleInput || verify.isPending;

  const ratioWithin = stale ? undefined : verify.data?.ratio_within_tolerance;
  const kcalWithin = stale ? undefined : verify.data?.kcal_within_tolerance;

  /**
   * Чего не хватает, чтобы нажать (правило П44 канона).
   *
   * Заказчица не дошла до подбора граммовки — единственного, чего нет у
   * программы, к которой она привыкла, — потому что кнопка была серой и не
   * сказала ни слова. Причина по одной за раз, в том порядке, в каком их
   * устраняют: сначала состав, потом цель.
   *
   * Строка на блок действий одна, а не по одной на кнопку: при пустом составе
   * обе причины совпадают, и два одинаковых абзаца подряд — это второе
   * сообщение об одном и том же (правило П27), да ещё и озвученное дважды.
   *
   * Про назначение здесь не говорится: этим занимается строка под целью и
   * подписи полей. Экран специалиста работает и вовсе без ребёнка (ADR-0027),
   * и утверждение «у ребёнка нет назначения» было бы там о ком-то, кого он не
   * выбирал.
   */
  const noRows = rows.length === 0;
  // Первая позиция тяжелее предела — её и называем: по имени человек найдёт
  // поле. Подбор граммов со входа не берёт, поэтому предел его не выключает.
  // Но переписывает он только то, что вошло в раскладку: строка, которую он
  // отбросил (легче 2 г или исключённая ребёнку), сохранит прежнюю массу, и
  // ошибка у поля останется.
  const tooHeavy = rows.find((row) => exceedsCalcGrams(row.grams));
  const solveBlockedBy = noRows
    ? t("blocked.noRows")
    : targets === null
      ? t("blocked.noTargets")
      : null;
  // Пересчёт цели не требует: множитель применяется к тому, что уже набрано.
  const tooHeavyReason =
    tooHeavy === undefined
      ? null
      : t("blocked.tooHeavy", {
          name: tooHeavy.product.name,
          max: CALC_GRAMS_MAX,
        });
  // Сохранение в карте ребёнка разрешает не тайминг, а сам ответ проверки:
  // успешный, на ЭТОТ массив состава (задержка передаёт ту же ссылку) и на
  // ЭТОГО ребёнка. Условие «не устарело и показатели есть» один коммит после
  // срабатывания задержки считало проверенным состав, запрос по которому ещё
  // не ушёл, — и сохранение успевало уйти. Только проверка называет продукты,
  // исключённые ребёнку, а сервер при сохранении их не проверяет (вопрос 29 —
  // предупреждение, а не запрет). Правка цели перезапускает проверку, когда
  // срабатывает задержка, и на время запроса снимает её ответ вместе с
  // предупреждением — на это время, а не на задержку, ждёт и сохранение.
  //
  // Передача из общего калькулятора ждёт только предела массы: сверять
  // исключённое там не с кем, а после передачи сразу открывается карта
  // ребёнка, где проверка идёт уже с ним и предупреждение появится.
  const checkedNow =
    verify.variables?.rows === rows &&
    verify.variables?.patientId === patientId;
  const saveBlockedBy =
    tooHeavyReason ??
    (verify.isError && checkedNow ? t("save.blocked.checkFailed") : null);
  // Подбор и пересчёт тоже расчёт: пока они идут (или ждут связи), в составе
  // ещё не те граммы, что сохранятся, — иначе после возврата связи в блюда
  // ребёнка ушли бы граммы до подбора, а экран показал бы подобранные.
  const actionsBusyReason =
    solve.isPending || scale.isPending ? t("actionsBusy") : null;
  const saveWaitsFor =
    actionsBusyReason ??
    (verify.isSuccess && checkedNow ? null : t("save.blocked.notChecked"));
  const scaleBlockedBy = noRows
    ? t("blocked.noRows")
    : tooHeavyReason !== null
      ? tooHeavyReason
      : factor > 0
        ? null
        : t("blocked.noFactor");
  // Показывается причина того действия, ради которого экран открывают: подбор
  // первый и главный. Если он доступен, а пересчёт нет — говорит пересчёт.
  const blockedBy = solveBlockedBy ?? scaleBlockedBy;
  const reasonId = useId();
  const waitingId = useId();
  const refusalId = useId();

  const infeasible = errorCodeOf(solve.error) === "infeasible_calculation";
  const actionError = solve.isError || scale.isError;
  // Отказ действия прячется, только если он дословно повторяет видимый отказ
  // проверки: по одному признаку «проверка в ошибке» пропала бы другая причина.
  const verifyShown = verify.isError && !stale;
  // Отказ, показанный над действиями. На время повтора он остаётся прежним
  // текстом: иначе на месте ошибки было бы пусто, а кнопка, по которой нажали,
  // исчезала бы вместе с фокусом — человек с клавиатуры оказывался в начале
  // страницы. Правка ввода снимает его сразу: он о другом составе.
  const [retry, setRetry] = useState<{
    input: typeof verifyInput;
    message: string;
  } | null>(null);
  // Повтор идёт, пока в работе ИМЕННО его запрос — вход совпадает по ссылке.
  // Не колбэком завершения: любой новый запуск (проверка после правки, подбор,
  // пересчёт) стирает колбэки прежнего, и «Повторяем…» зависало навсегда
  // рядом со свежими показателями.
  const retryIsThisRequest = retry !== null && verify.variables === retry.input;
  const retrying = retryIsThisRequest && verify.isPending;
  const retryFailed = retryIsThisRequest && verify.isError;
  const refusalMessage = staleInput
    ? null
    : verifyShown
      ? (errorMessageOf(verify.error) ?? t("common:errors.unexpected"))
      : retrying
        ? (retry?.message ?? null)
        : null;
  // Повтор отказал снова ТЕМ ЖЕ текстом: область `role="alert"` не меняется и
  // заново не объявляется — поэтому скрытая строка ниже. Отказ с другим
  // текстом объявит сам алерт, и второе объявление было бы лишним.
  const announceRetryFailed =
    retryFailed && !staleInput && refusalMessage === retry?.message;
  const actionMessage = errorMessageOf(solve.error ?? scale.error);
  const duplicateOfVerify =
    verifyShown && actionMessage === errorMessageOf(verify.error);
  const busy = solve.isPending || scale.isPending;
  // Без сети проверка не уходит, а ждёт связи (`isPaused`). Результат прежнего
  // запуска мутация при старте уже сбросила, и блок расчёта пропадал без
  // единого слова — будто состав не считается вовсе. С возвратом сети
  // TanStack продолжает её сам. На повторе без сети говорят отказ и
  // «Повторяем…».
  const waitingForNetwork = verify.isPaused && !retrying;
  // Без сети подбор и пересчёт тоже не уходят, а ждут связи, и кнопка стояла
  // на «Подбираем…» без причины. Если о связи уже говорит проверка — строкой
  // ожидания или плашкой повтора, — второй строкой с тем же текстом это не
  // повторяется (правило П27), и занятая кнопка описывается тем, что на экране.
  const actionsPaused = solve.isPaused || scale.isPaused;
  const verifyWaitingId = waitingForNetwork
    ? waitingId
    : retrying && verify.isPaused && refusalMessage !== null
      ? refusalId
      : null;
  const actionWaitingReason =
    actionsPaused && verifyWaitingId === null ? t("waitingForNetwork") : null;
  const actionsBlockedBy = actionWaitingReason ?? blockedBy;
  const actionsWaitingDescription =
    actionWaitingReason !== null
      ? reasonId
      : actionsPaused && verifyWaitingId !== null
        ? verifyWaitingId
        : undefined;

  function resetActions() {
    solve.reset();
    scale.reset();
  }

  return (
    /* Ширину калькулятор несёт с собой, а не берёт у экрана: в разделе кабинета
       оболочка уже ограничена ролью «форма», а в карте пациента она шире —
       и те же блоки растягивались там на 1102 px под поля в 123 px. Одна
       колонка на все размещения — одна правая линия у поиска, состава, полосы
       макронутриентов и кнопок. */
    <div className="flex max-w-form flex-col gap-screen">
      <Section
        title={t("composition.title")}
        description={t("composition.description")}
      >
        <ProductPicker
          patientId={patientId}
          // Здесь собирают блюдо, и сюда набирают его название целиком:
          // «суп из говядины» в поиске продуктов — то, на чём застряла
          // заказчица. В форме рецепта и в исключённых продуктах такого
          // предложения быть не должно.
          suggestRecipes
          excludeIds={rows.map((r) => r.product.id)}
          onPick={(product) => {
            setRows((current) => [...current, { product, grams: 50 }]);
            resetActions();
          }}
        />

        <DishRows
          rows={rows}
          contributions={contributions}
          stale={stale}
          onChangeGrams={(productId, grams) => {
            setRows((current) =>
              current.map((row) =>
                row.product.id === productId ? { ...row, grams } : row,
              ),
            );
            resetActions();
          }}
          onRemove={(productId) => {
            setRows((current) =>
              current.filter((row) => row.product.id !== productId),
            );
            resetActions();
          }}
        />
      </Section>

      {/* Что ребёнку нельзя — над расчётом, а не под ним: подбор снимает такие
          продукты со входа, и по числам этого не видно.
          Запрещать или предупреждать — вопрос 29 медицинской команде. */}
      {(excluded.length > 0 || solveExcluded.length > 0) && (
        <WarningBanner level="danger" title={t("excluded.title")}>
          {excluded.length > 0 && (
            <p className="m-0">
              {t("excluded.verify", {
                list: namesOf(excluded, t("excluded.unknownProduct")),
              })}
            </p>
          )}
          {solveExcluded.length > 0 && (
            <p className="m-0">
              {t("excluded.solve", {
                list: namesOf(solveExcluded, t("excluded.unknownProduct")),
              })}
            </p>
          )}
        </WarningBanner>
      )}

      {/* Цель, факт и действия — одним блоком, в этом порядке. Цель обязана
          стоять выше вердикта о ней; факт обязан стоять рядом с составом, иначе
          правка граммовки уводит итог ниже сгиба (замер на 1280×800). Оба
          требования выполняются, только если цель и факт лежат в одном блоке —
          так же устроен и кабинет, к которому привыкла клиника: строка «Goal»
          прямо над строкой «Actual». */}
      <Section title={t("calc.title")}>
        <GoalFields
          ratio={ratio}
          kcal={kcal}
          suggested={suggested}
          prescription={prescription}
          onChange={(next) => {
            touched.current = true;
            setRatio(next.ratio);
            setKcal(next.kcal);
            resetActions();
          }}
        />

        {/* Область постоянна: живую область, появившуюся вместе с текстом,
            озвучивают не все программы чтения с экрана. Пустая — вне потока. */}
        <p
          id={waitingId}
          role="status"
          className={
            waitingForNetwork ? "m-0 text-sm text-muted-foreground" : "sr-only"
          }
        >
          {waitingForNetwork ? t("waitingForNetwork") : ""}
        </p>
        {/* Пустой расчёт молчит: о том, что состав не набран, уже сказано в
            блоке состава — строкой над этим. Своя фраза здесь была вторым
            сообщением об одном и том же (правило П27 канона), и вместе с
            рамкой пустого состава они отодвигали цель на 200 px вниз. */}
        {dish === null ? null : (
          <div
            aria-busy={stale}
            className={stale ? "opacity-60 transition-opacity" : undefined}
          >
            <DishResultView
              dish={dish}
              goal={targets}
              ratioWithinTolerance={ratioWithin ?? undefined}
              kcalWithinTolerance={kcalWithin ?? undefined}
            />
            {stale && (
              <p role="status" className="m-0 text-sm text-muted-foreground">
                {t("recalculating")}
              </p>
            )}
          </div>
        )}

        {/* Отказ проверки не показывался вовсе: показатели просто исчезали, и
            после пересчёта порций в массы, которые расчёт уже не принимает,
            человек видел пустоту без причины. Пока правка не догнала расчёт,
            прежний отказ не показывается — он о другом составе. */}
        {refusalMessage !== null && (
          <div className="flex flex-col items-start gap-field">
            <div id={refusalId}>
              <FormError>{refusalMessage}</FormError>
            </div>
            {/* Повтор — только при сбое: отказ по данным при том же составе
                повторится слово в слово (правило в ките, общее с Mini App). */}
            {(retrying || canRetry(errorCodeOf(verify.error))) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                // `aria-disabled`, а не `disabled`: выключенная кнопка теряет
                // фокус, а повторное нажатие гасит сам обработчик.
                className="aria-disabled:opacity-50"
                aria-disabled={retrying || undefined}
                aria-busy={retrying || undefined}
                onClick={() => {
                  if (retrying) return;
                  // Без сети повтор не уходит, а ждёт: прежний отказ («что-то
                  // пошло не так») рядом с «Повторяем…» не говорил главного.
                  // Текст ожидания запоминается как показанный отказ — и после
                  // возврата сети плашка не возвращается к старому отказу, а
                  // новый отказ объявит себя сам. Пауза бывает только при
                  // запуске без сети: мутация, начатая с сетью, падает.
                  setRetry({
                    input: verifyInput,
                    message: onlineManager.isOnline()
                      ? refusalMessage
                      : t("waitingForNetwork"),
                  });
                  runVerify();
                }}
              >
                {retrying
                  ? t("common:actions.retrying")
                  : t("common:actions.retry")}
              </Button>
            )}
          </div>
        )}
        {/* Постоянная область: появившаяся вместе с текстом объявляется не
            всеми программами чтения с экрана. */}
        <p role="status" className="sr-only">
          {retrying && !verify.isPaused
            ? t("common:actions.retrying")
            : announceRetryFailed
              ? refusalMessage
              : ""}
        </p>

        <Separator />

        {/* Два действия, и у каждого свой ввод прямо над ним.

            Раньше ряд начинался кнопкой «Подобрать граммовку», за ней шло чужое
            поле «Коэффициент порции» с кнопкой пересчёта, а ограничения подбора
            стояли ПОД всем этим — то есть поля действия читались после самого
            действия, а два разных действия делили одну строку. Порядок «поля →
            кнопка» — правило П9 канона, и он же отвечает на вопрос «что эта
            кнопка возьмёт в расчёт».

            Подбор остаётся первым и крупным (ADR-0028): это главное, чего нет у
            KDC, где граммовку доводят стрелками вручную. */}
        <div className="flex flex-col gap-block">
          {/* Ограничения касаются только подбора: проверке они ничего не
              меняют. Поэтому стоят при его кнопке, а не в цели. */}
          <div className="flex flex-wrap items-start gap-block">
            <Field
              id="protein-min"
              width="narrow"
              label={t("targets.proteinMin")}
              optional
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={proteinMin ?? ""}
              onChange={(e) => {
                // Подбор, ждущий связи, иначе вписал бы раскладку по прежнему
                // пределу, и вердикт этого не заметил бы: пределов он не судит.
                setProteinMin(e.target.value === "" ? null : +e.target.value);
                solve.reset();
              }}
              className="tabular-nums"
            />
            <Field
              id="carbs-max"
              width="narrow"
              label={t("targets.carbsMax")}
              optional
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={carbsMax ?? ""}
              onChange={(e) => {
                setCarbsMax(e.target.value === "" ? null : +e.target.value);
                solve.reset();
              }}
              className="tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-field">
            <div>
              <Button
                type="button"
                size="lg"
                className="min-h-touch"
                disabled={solveBlockedBy !== null || busy}
                aria-busy={solve.isPending}
                aria-describedby={
                  solveBlockedBy !== null ? reasonId : actionsWaitingDescription
                }
                onClick={() => {
                  if (targets === null) return;
                  scale.reset();
                  solve.mutate({ rows, targets, patientId });
                }}
              >
                {solve.isPending ? t("actions.solving") : t("actions.solve")}
              </Button>
            </div>
          </div>

          {/* Пересчёт порций — второе действие, со своим числом.

              `[&_[data-slot=field]]:mb-0` снимает у поля нижний отступ формы:
              ряд равняется по низу, и без этого кнопка равнялась на нижний край
              ОТСТУПА поля, а не самого поля — поле оказывалось на 16 px выше. */}
          <div className="flex flex-col gap-field">
            <div className="flex flex-wrap items-end gap-field [&_[data-slot=field]]:mb-0">
              <Field
                id="factor"
                width="tiny"
                label={t("factor")}
                // Пересчёт ПЕРЕПИСЫВАЕТ граммовку в составе, и сказать об
                // этом обязан тот, кто предлагает нажать: в Mini App подпись
                // была, в кабинете — нет.
                hint={t("factorHint")}
                type="number"
                inputMode="decimal"
                min={0.1}
                step={0.1}
                value={factor}
                onChange={(event) => {
                  // Пересчёт, ждущий связи, иначе вписал бы граммы по прежнему
                  // множителю — как в Mini App.
                  setFactor(Number(event.target.value));
                  scale.reset();
                }}
                className="tabular-nums"
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-touch"
                disabled={scaleBlockedBy !== null || busy}
                aria-busy={scale.isPending}
                aria-describedby={
                  scaleBlockedBy !== null ? reasonId : actionsWaitingDescription
                }
                onClick={() => {
                  solve.reset();
                  scale.mutate({ rows, factor });
                }}
              >
                {scale.isPending ? t("actions.scaling") : t("actions.scale")}
              </Button>
            </div>
          </div>

          {/* Одна область на блок действий, и она постоянна: живая область,
              появившаяся вместе с текстом, озвучивается не всеми программами
              чтения с экрана. */}
          <ActionReason id={reasonId}>{actionsBlockedBy}</ActionReason>
        </div>
      </Section>

      {/* Неразрешимая задача — не ошибка, а объяснимый результат (раздел 8.3 ТЗ):
          сервер возвращает человекочитаемую причину, её и показываем. Для врача
          это и есть ответ на его вопрос: назначение на этих продуктах не
          собирается. */}
      {infeasible && (
        <WarningBanner level="danger" title={t("infeasible.title")}>
          {errorMessageOf(solve.error)}
        </WarningBanner>
      )}

      {/* Отказ действия, дословно повторяющий видимый отказ проверки, — вторая
          строка с тем же текстом (правило П27). */}
      {actionError && !infeasible && !duplicateOfVerify && (
        <FormError>{actionMessage ?? t("common:errors.unexpected")}</FormError>
      )}

      {/* Форма стоит, пока есть состав, а не пока есть показатели: показатели
          пропадают на каждой массе тяжелее предела, и вместе с формой
          пропадали бы набранное название и выбранный пациент. Состав тяжелее
          предела или ещё не проверенный форма отправить не даёт и говорит
          почему. */}
      {rows.length > 0 && (
        <>
          {/* Куда уходит собранный состав, зависит от того, чей это экран:
              в карте ребёнка — сразу в его блюда, в общем калькуляторе —
              вместе с выбором ребёнка. */}
          {patientId === undefined ? (
            <HandOffToPatient
              rows={rows}
              blockedBy={tooHeavyReason}
              waitingFor={actionsBusyReason}
            />
          ) : (
            <SaveDishForm
              patientId={patientId}
              rows={rows}
              blockedBy={saveBlockedBy}
              waitingFor={saveWaitsFor}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Названия исключённых продуктов, а не их идентификаторы: продукт могли убрать
 * из справочника, и 36 знаков UUID человеку не говорят ничего.
 *
 * Mini App говорит здесь словами с самого начала (находка М6 его аудита), а
 * кабинет печатал UUID — то самое расхождение каналов, ради которого экраны и
 * сводились.
 */
function namesOf(
  entries: { product_id: string; name_ru?: string | null }[],
  unknown: string,
) {
  return entries.map((entry) => entry.name_ru ?? unknown).join(", ");
}

/**
 * Цель расчёта: соотношение и калорийность приёма.
 *
 * Значения из назначения подставляются вместе с арифметикой, по которой
 * посчитаны, — «1200 ккал ÷ 4 приёма». Молча подставленное число неотличимо от
 * введённого человеком, а деление суточной нормы на приёмы — медицинское
 * допущение, и человек должен видеть, что оно принято. Само допущение живёт в
 * ките (`mealTargetsFrom`): та же цель показывается той же семье в Mini App.
 */
function GoalFields({
  ratio,
  kcal,
  suggested,
  prescription,
  onChange,
}: {
  ratio: number | null;
  kcal: number | null;
  suggested: TargetsInput | null;
  prescription: { kcal_per_day: number; meals_per_day: number } | null;
  onChange: (next: { ratio: number | null; kcal: number | null }) => void;
}) {
  const { t } = useTranslation("calculator");

  const fromPrescription =
    prescription === null
      ? null
      : t("goal.fromPrescription", {
          kcal: prescription.kcal_per_day,
          meals: prescription.meals_per_day,
        });

  return (
    <div className="flex flex-col gap-field">
      {/* Рядом и на телефоне: поля короткие (числовые, ширина из шкалы), а
          сложенные в столбик они отодвигали показатели блюда почти на сотню
          пикселей вниз — а они обязаны читаться рядом с целью.

          Ряд, а не две колонки блока: колонки делят ШИРИНУ БЛОКА пополам, и в
          блоке 1102 px поле «Кетосоотношение» (123 px по шкале) стояло в 559 px
          от поля «Калорийность» — пара читалась как два несвязанных поля, а
          пояснение к правому уезжало к краю экрана. Ширину пары теперь задают
          сами поля. */}
      <div className="flex items-start gap-block">
        {/* Каждое поле — своя доля строки на телефоне и своя ширина на
            десктопе: числовое поле занимает строку целиком до `sm`, и в
            свободном ряду пара распадалась на две строки — а показатели
            блюда обязаны читаться рядом с целью. */}
        <div className="min-w-0 flex-1 sm:flex-none">
          <Field
            id="ratio"
            width="narrow"
            label={t("targets.ratio")}
            hint={
              suggested !== null && ratio === suggested.ratio
                ? t("goal.ratioFromPrescription")
                : undefined
            }
            type="number"
            inputMode="decimal"
            min={1}
            max={5}
            step={0.5}
            value={ratio ?? ""}
            onChange={(e) =>
              onChange({
                ratio: e.target.value === "" ? null : +e.target.value,
                kcal,
              })
            }
            className="tabular-nums"
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none">
          <Field
            id="kcal"
            width="narrow"
            label={t("targets.kcal")}
            hint={
              suggested !== null && kcal === suggested.kcal
                ? (fromPrescription ?? undefined)
                : t("goal.kcalHint")
            }
            type="number"
            inputMode="decimal"
            min={1}
            step={10}
            value={kcal ?? ""}
            onChange={(e) =>
              onChange({
                ratio,
                kcal: e.target.value === "" ? null : +e.target.value,
              })
            }
            className="tabular-nums"
          />
        </div>
      </div>

      {/* Цели нет — и сравнивать не с чем. Сказать это прямо честнее, чем
          подставить своё число и объявить блюдо не попавшим в него. */}
      {(ratio === null || kcal === null) && (
        <p className="m-0 text-sm text-muted-foreground">{t("goal.none")}</p>
      )}
    </div>
  );
}
