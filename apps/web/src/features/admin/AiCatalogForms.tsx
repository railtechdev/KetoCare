import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Checkbox,
  FormFooter,
  Section,
  StatusNote,
} from "@ketocare/ui";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { errorMessageOf } from "../../lib/api";
import {
  useAiPriceSuggestion,
  useCheckAiKey,
  useCreateAiProvider,
  useReplaceAiKey,
  useSaveAiModel,
  useUpdateAiProvider,
  type AiModelView,
  type AiProviderKind,
  type AiProviderView,
  type AiSettings,
} from "./useAiSettings";

/** Верхняя граница цены за миллион — та же, что у сервера (`PRICE_MAX_USD`). */
const PRICE_MAX = 10000;

// --- подключение -------------------------------------------------------------

const providerSchema = z.object({
  kind: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  baseUrl: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value === "" || /^https?:\/\/\S+$/.test(value)),
  apiKey: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || (value.length >= 8 && /^\S+$/.test(value)),
    ),
  enabled: z.boolean(),
});
type ProviderValues = z.infer<typeof providerSchema>;

/**
 * Подключение к поставщику моделей (ADR-0082): вид, имя, для своих серверов и
 * шлюзов — адрес. Подключений одного вида может быть несколько: второй ключ
 * для технических работ — это отдельный счёт у поставщика.
 *
 * При создании ключ можно ввести сразу — иначе подключение пришлось бы
 * открывать второй раз только ради него.
 */
export function AiProviderForm({
  provider,
  kinds,
  existing,
  onDone,
}: {
  provider?: AiProviderView;
  kinds: AiSettings["provider_kinds"];
  /** Подключения до сохранения: новое — то, которого среди них нет. */
  existing: AiSettings["providers"];
  onDone: () => void;
}) {
  const { t } = useTranslation("admin");
  const ids = useId();
  const create = useCreateAiProvider();
  const update = useUpdateAiProvider();
  const replaceKey = useReplaceAiKey();
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, submitCount },
  } = useForm<ProviderValues>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      kind: provider?.kind ?? "openai",
      name: provider?.name ?? "",
      baseUrl: provider?.base_url ?? "",
      apiKey: "",
      enabled: provider?.enabled ?? true,
    },
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  const kind = kinds.find((item) => item.kind === watch("kind"));
  const pending = create.isPending || update.isPending || replaceKey.isPending;
  const failure = create.error ?? update.error ?? replaceKey.error;

  return (
    <form
      noValidate
      className="flex flex-col gap-section"
      onSubmit={handleSubmit((values) => {
        if (kind?.needs_base_url && values.baseUrl === "") {
          setError("baseUrl", { type: "required" });
          return;
        }
        const body = {
          kind: values.kind as AiProviderKind,
          name: values.name.trim(),
          base_url: values.baseUrl || null,
          enabled: values.enabled,
        };
        if (provider) {
          update.mutate(
            { providerId: provider.id, body },
            { onSuccess: onDone },
          );
          return;
        }
        create.mutate(body, {
          onSuccess: (settings) => {
            // Идентификатор нового подключения выдаёт сервер.
            const created = settings.providers.find(
              (item) => !existing.some((before) => before.id === item.id),
            );
            if (values.apiKey && created) {
              replaceKey.mutate(
                { providerId: created.id, apiKey: values.apiKey },
                { onSuccess: onDone },
              );
            } else {
              onDone();
            }
          },
        });
      })}
    >
      <FormErrorSummary
        title={t("errorSummary.title")}
        items={errorSummaryItems(submitCount, [
          [`${ids}-name`, errors.name && t("ai.errors.providerName")],
          [`${ids}-url`, errors.baseUrl && t("ai.errors.baseUrl")],
          [`${ids}-key`, errors.apiKey && t("ai.errors.key")],
        ])}
        focusKey={submitCount}
      />

      <Section
        title={
          provider ? t("ai.providerForm.editTitle") : t("ai.providerForm.title")
        }
      >
        {failure && (
          <FormError>
            {errorMessageOf(failure) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <SelectField
          id={`${ids}-kind`}
          label={t("ai.providerForm.kind")}
          hint={
            provider
              ? t("ai.providerForm.kindFixed")
              : t(`ai.providerKinds.${watch("kind")}.hint`, {
                  defaultValue: "",
                })
          }
          disabled={provider !== undefined}
          {...register("kind")}
        >
          {kinds.map((item) => (
            <option key={item.kind} value={item.kind}>
              {t(`ai.providerKinds.${item.kind}.title`)}
            </option>
          ))}
        </SelectField>

        <Field
          id={`${ids}-name`}
          label={t("ai.providerForm.name")}
          hint={t("ai.providerForm.nameHint")}
          error={errors.name && t("ai.errors.providerName")}
          {...register("name")}
        />

        <Field
          id={`${ids}-url`}
          inputMode="url"
          spellCheck={false}
          optional={!kind?.needs_base_url}
          label={t("ai.providerForm.baseUrl")}
          hint={
            kind?.default_base_url
              ? t("ai.providerForm.baseUrlDefault", {
                  url: kind.default_base_url,
                })
              : t("ai.providerForm.baseUrlRequired")
          }
          error={errors.baseUrl && t("ai.errors.baseUrl")}
          {...register("baseUrl")}
        />

        {!provider && (
          <Field
            id={`${ids}-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            optional
            label={t("ai.key.field")}
            hint={
              kind?.needs_key
                ? t("ai.providerForm.keyHint")
                : t("ai.providerForm.keyOptionalHint")
            }
            error={errors.apiKey && t("ai.errors.key")}
            {...register("apiKey")}
          />
        )}

        <label
          htmlFor={`${ids}-enabled`}
          className="flex min-h-touch items-center gap-field text-sm font-medium"
        >
          <Checkbox id={`${ids}-enabled`} {...register("enabled")} />
          {t("ai.providerForm.enabled")}
        </label>

        <FormFooter
          submitLabel={t("common:actions.save")}
          pendingLabel={t("common:actions.saving")}
          pending={pending}
          cancelLabel={t("common:actions.cancel")}
          onCancel={onDone}
        />
      </Section>
    </form>
  );
}

// --- модель каталога ---------------------------------------------------------

const price = z
  .string()
  .trim()
  .refine((value) => {
    if (value === "") return false;
    const number = Number(value.replace(",", "."));
    return Number.isFinite(number) && number >= 0 && number <= PRICE_MAX;
  });

const modelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().trim().min(1).max(120).regex(/^\S+$/),
  name: z.string().trim().max(80),
  priceIn: price,
  priceOut: price,
  enabled: z.boolean(),
});
type ModelValues = z.infer<typeof modelSchema>;

/**
 * Модель каталога: у какого подключения, как она там называется и сколько
 * стоит. Без цены модель выбрать нельзя — бюджет не посчитал бы её расход;
 * ноль — это утверждение «бесплатна» (своя модель на своём сервере).
 *
 * Известную публичную цену форма подставляет сама, список моделей подключения
 * подгружается кнопкой. Обе подсказки — только подсказки: считают по тому, что
 * сохранено.
 */
export function AiModelForm({
  model,
  providers,
  onDone,
}: {
  model?: AiModelView;
  providers: AiSettings["providers"];
  onDone: () => void;
}) {
  const { t } = useTranslation("admin");
  const ids = useId();
  const save = useSaveAiModel();
  const suggestion = useAiPriceSuggestion();
  const listing = useCheckAiKey();
  const [suggested, setSuggested] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors, submitCount },
  } = useForm<ModelValues>({
    resolver: zodResolver(modelSchema),
    defaultValues: {
      provider: model?.provider ?? providers[0]?.id ?? "",
      model: model?.model ?? "",
      name: model?.name ?? "",
      priceIn: model?.usd_per_mtok_in ?? "",
      priceOut: model?.usd_per_mtok_out ?? "",
      enabled: model?.enabled ?? true,
    },
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  const suggestPrice = () => {
    const { provider, model: id, priceIn, priceOut } = getValues();
    // Подсказка не перетирает набранное: цена могла быть договорной.
    if (id.trim() === "" || priceIn !== "" || priceOut !== "") return;
    suggestion.mutate(
      { provider, model: id.trim() },
      {
        onSuccess: (found) => {
          if (!found.known) return;
          setValue("priceIn", found.usd_per_mtok_in ?? "");
          setValue("priceOut", found.usd_per_mtok_out ?? "");
          setSuggested(true);
        },
      },
    );
  };

  const modelField = register("model");
  const listed = listing.data?.ok ? listing.data.models : [];

  return (
    <form
      noValidate
      className="flex flex-col gap-section"
      onSubmit={handleSubmit((values) =>
        save.mutate(
          {
            provider: values.provider,
            model: values.model.trim(),
            name: values.name.trim() || null,
            usd_per_mtok_in: values.priceIn.replace(",", "."),
            usd_per_mtok_out: values.priceOut.replace(",", "."),
            enabled: values.enabled,
          },
          { onSuccess: onDone },
        ),
      )}
    >
      <FormErrorSummary
        title={t("errorSummary.title")}
        items={errorSummaryItems(submitCount, [
          [`${ids}-model`, errors.model && t("ai.errors.modelId")],
          [`${ids}-in`, errors.priceIn && t("ai.errors.price")],
          [`${ids}-out`, errors.priceOut && t("ai.errors.price")],
        ])}
        focusKey={submitCount}
      />

      <Section
        title={model ? t("ai.modelForm.editTitle") : t("ai.modelForm.title")}
      >
        {save.isError && (
          <FormError>
            {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <SelectField
          id={`${ids}-provider`}
          label={t("ai.modelForm.provider")}
          disabled={model !== undefined}
          {...register("provider")}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </SelectField>

        <Field
          id={`${ids}-model`}
          spellCheck={false}
          autoComplete="off"
          list={`${ids}-models`}
          readOnly={model !== undefined}
          label={t("ai.modelForm.model")}
          hint={
            model ? t("ai.modelForm.modelFixed") : t("ai.modelForm.modelHint")
          }
          error={errors.model && t("ai.errors.modelId")}
          {...modelField}
          onBlur={(event) => {
            void modelField.onBlur(event);
            suggestPrice();
          }}
        />
        <datalist id={`${ids}-models`}>
          {listed.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        {!model && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={listing.isPending}
              onClick={() =>
                listing.mutate({
                  providerId: getValues("provider"),
                  apiKey: null,
                })
              }
            >
              {listing.isPending
                ? t("ai.modelForm.listing")
                : t("ai.modelForm.list")}
            </Button>
            {listing.data && (
              <span className="text-sm text-muted-foreground">
                {listing.data.ok
                  ? t("ai.modelForm.listed", { count: listed.length })
                  : t(`ai.key.problem.${listing.data.problem ?? "unexpected"}`)}
              </span>
            )}
          </div>
        )}

        <Field
          id={`${ids}-name`}
          optional
          label={t("ai.modelForm.name")}
          hint={t("ai.modelForm.nameHint")}
          {...register("name")}
        />

        <Field
          id={`${ids}-in`}
          width="narrow"
          inputMode="decimal"
          label={t("ai.modelForm.priceIn")}
          hint={t("ai.modelForm.priceHint")}
          error={errors.priceIn && t("ai.errors.price")}
          {...register("priceIn")}
        />
        <Field
          id={`${ids}-out`}
          width="narrow"
          inputMode="decimal"
          label={t("ai.modelForm.priceOut")}
          error={errors.priceOut && t("ai.errors.price")}
          {...register("priceOut")}
        />
        {suggested && <StatusNote>{t("ai.modelForm.suggested")}</StatusNote>}

        <label
          htmlFor={`${ids}-enabled`}
          className="flex min-h-touch items-center gap-field text-sm font-medium"
        >
          <Checkbox id={`${ids}-enabled`} {...register("enabled")} />
          {t("ai.modelForm.enabled")}
        </label>

        <FormFooter
          submitLabel={t("common:actions.save")}
          pendingLabel={t("common:actions.saving")}
          pending={save.isPending}
          cancelLabel={t("common:actions.cancel")}
          onCancel={onDone}
        />
      </Section>
    </form>
  );
}
