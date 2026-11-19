import { zodResolver } from "@hookform/resolvers/zod";
import {
  AsyncSection,
  formatOccurredAt,
  Button,
  Columns,
  ConfirmDialog,
  FormFooter,
  Section,
  StatusNote,
} from "@ketocare/ui";
import { useId, useRef, useState } from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import {
  LetterheadFull,
  LetterheadRunning,
} from "../letterhead/LetterheadBlock";
import {
  useLetterhead,
  useLetterheadLogoUrl,
  useRemoveLogo,
  useSaveLetterhead,
  useUploadLogo,
  type Letterhead,
  type LetterheadText,
} from "../letterhead/useLetterhead";

/** Границы — те же, что у сервера (`core.letterhead.LetterheadText`). */
const optional = (max: number) => z.string().trim().max(max);

const schema = z.object({
  name_uz: z.string().trim().min(1).max(255),
  name_ru: optional(255),
  short_name: z.string().trim().min(1).max(40),
  department: optional(120),
  address: optional(255),
  family_phone: optional(40),
  contact: optional(120),
  license: optional(120),
  stir: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{9}$/.test(value)),
});

type Values = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape) as Array<keyof Values>;

function toValues(text: LetterheadText | null | undefined): Values {
  return Object.fromEntries(
    FIELDS.map((key) => [key, text?.[key] ?? ""]),
  ) as Values;
}

function toBody(values: Values): LetterheadText {
  return Object.fromEntries(
    FIELDS.map((key) => [key, values[key] === "" ? null : values[key]]),
  ) as unknown as LetterheadText;
}

/**
 * «Бланк клиники» (ADR-0092): логотип, название и реквизиты в шапке всех
 * документов. Логотип загружается сразу при выборе файла — это отдельное
 * действие, не поле формы; текст сохраняется кнопкой. Рядом — как бланк
 * выйдет на листе, по мере набора.
 */
export function LetterheadPanel() {
  const { t } = useTranslation("admin");
  const letterhead = useLetterhead();

  return (
    <AsyncSection
      {...queryState(letterhead)}
      skeleton={<StatusNote>{t("letterhead.loading")}</StatusNote>}
      error={
        letterhead.isError
          ? {
              title: t("letterhead.loadError"),
              description:
                errorMessageOf(letterhead.error) ??
                t("common:errors.unexpected"),
            }
          : null
      }
      retryLabel={t("common:actions.retry")}
      onRetry={() => void letterhead.refetch()}
      isEmpty={false}
      empty={null}
    >
      {letterhead.data && <LetterheadEditor letterhead={letterhead.data} />}
    </AsyncSection>
  );
}

function LetterheadEditor({ letterhead }: { letterhead: Letterhead }) {
  const { t } = useTranslation("admin");
  const ids = useId();
  const save = useSaveLetterhead();
  const logoUrl = useLetterheadLogoUrl(letterhead.logo?.sha256);
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, submitCount, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(letterhead.text),
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  const errorOf = (key: keyof Values) =>
    errors[key] && t(`letterhead.errors.${key}`);

  return (
    <Columns
      asideWidth="wide"
      asideSticky
      main={
        <div className="flex flex-col gap-section">
          <LogoSection letterhead={letterhead} logoUrl={logoUrl} />
          <form
            noValidate
            className="flex flex-col gap-section"
            onSubmit={handleSubmit((values) =>
              save.mutate(toBody(values), {
                onSuccess: (saved) => reset(toValues(saved.text)),
              }),
            )}
          >
            <FormErrorSummary
              title={t("errorSummary.title")}
              items={errorSummaryItems(
                submitCount,
                FIELDS.map((key) => [`${ids}-${key}`, errorOf(key)]),
              )}
              focusKey={submitCount}
            />
            <Section
              title={t("letterhead.names.title")}
              description={t("letterhead.names.intro")}
            >
              <Field
                id={`${ids}-name_uz`}
                lang="uz"
                label={t("letterhead.fields.name_uz")}
                error={errorOf("name_uz")}
                {...register("name_uz")}
              />
              <Field
                id={`${ids}-name_ru`}
                optional
                label={t("letterhead.fields.name_ru")}
                error={errorOf("name_ru")}
                {...register("name_ru")}
              />
              <Field
                id={`${ids}-short_name`}
                width="medium"
                label={t("letterhead.fields.short_name")}
                hint={t("letterhead.hints.short_name")}
                error={errorOf("short_name")}
                {...register("short_name")}
              />
              <Field
                id={`${ids}-department`}
                width="wide"
                optional
                label={t("letterhead.fields.department")}
                error={errorOf("department")}
                {...register("department")}
              />
            </Section>
            <Section
              title={t("letterhead.contacts.title")}
              description={t("letterhead.contacts.intro")}
            >
              <Field
                id={`${ids}-address`}
                optional
                label={t("letterhead.fields.address")}
                error={errorOf("address")}
                {...register("address")}
              />
              <Field
                id={`${ids}-family_phone`}
                width="medium"
                inputMode="tel"
                optional
                label={t("letterhead.fields.family_phone")}
                hint={t("letterhead.hints.family_phone")}
                error={errorOf("family_phone")}
                {...register("family_phone")}
              />
              <Field
                id={`${ids}-contact`}
                width="wide"
                optional
                label={t("letterhead.fields.contact")}
                error={errorOf("contact")}
                {...register("contact")}
              />
              <Field
                id={`${ids}-license`}
                width="wide"
                optional
                label={t("letterhead.fields.license")}
                hint={t("letterhead.hints.license")}
                error={errorOf("license")}
                {...register("license")}
              />
              <Field
                id={`${ids}-stir`}
                width="narrow"
                inputMode="numeric"
                optional
                label={t("letterhead.fields.stir")}
                hint={t("letterhead.hints.stir")}
                error={errorOf("stir")}
                {...register("stir")}
              />
              {save.isError && (
                <FormError>
                  {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
                </FormError>
              )}
              <FormFooter
                submitLabel={t("common:actions.save")}
                pendingLabel={t("common:actions.saving")}
                pending={save.isPending}
                disabled={!isDirty}
                extra={
                  letterhead.updated_at ? (
                    <StatusNote>
                      {t("letterhead.savedAt", {
                        when: formatOccurredAt(new Date(letterhead.updated_at)),
                      })}
                    </StatusNote>
                  ) : undefined
                }
              />
            </Section>
          </form>
        </div>
      }
      aside={
        <Preview
          control={control}
          logoUrl={logoUrl}
          fallbackName={letterhead.fallback_name}
        />
      }
      asideLabel={t("letterhead.preview.title")}
    />
  );
}

function LogoSection({
  letterhead,
  logoUrl,
}: {
  letterhead: Letterhead;
  logoUrl: string | undefined;
}) {
  const { t } = useTranslation("admin");
  const ids = useId();
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  const input = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  const logo = letterhead.logo;

  return (
    <Section
      title={t("letterhead.logo.title")}
      description={t("letterhead.logo.intro")}
    >
      {logo && logoUrl && (
        <div className="flex flex-wrap items-center gap-4">
          <img
            src={logoUrl}
            alt={t("letterhead.logo.current")}
            className="h-16 w-auto max-w-64 rounded-md border border-border bg-background object-contain p-1"
          />
          {/* Тот же знак в сером — так он выйдет на чёрно-белом принтере. */}
          <img
            src={logoUrl}
            alt={t("letterhead.logo.grey")}
            className="h-16 w-auto max-w-64 rounded-md border border-border bg-background object-contain p-1 grayscale"
          />
          <p className="text-sm text-muted-foreground">
            {t("letterhead.logo.size", {
              width: String(logo.width),
              height: String(logo.height),
            })}
          </p>
        </div>
      )}
      <Field
        ref={input}
        id={`${ids}-file`}
        type="file"
        accept="image/png"
        width="wide"
        label={
          logo ? t("letterhead.logo.replace") : t("letterhead.logo.choose")
        }
        hint={t("letterhead.logo.hint")}
        error={
          upload.isError
            ? (errorMessageOf(upload.error) ?? t("common:errors.unexpected"))
            : undefined
        }
        disabled={upload.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file === undefined) return;
          upload.mutate(file, {
            onSettled: () => {
              if (input.current) input.current.value = "";
            },
          });
        }}
      />
      {upload.isPending && (
        <StatusNote>{t("letterhead.logo.uploading")}</StatusNote>
      )}
      {logo && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          trigger={
            <Button type="button" variant="outline" className="self-start">
              {t("letterhead.logo.remove")}
            </Button>
          }
          title={t("letterhead.logo.removeTitle")}
          description={t("letterhead.logo.removeDescription")}
          confirmLabel={t("letterhead.logo.remove")}
          cancelLabel={t("common:actions.cancel")}
          onConfirm={() => remove.mutate()}
        />
      )}
    </Section>
  );
}

function Preview({
  control,
  logoUrl,
  fallbackName,
}: {
  control: Control<Values>;
  logoUrl: string | undefined;
  fallbackName: string;
}) {
  const { t } = useTranslation("admin");
  const values = useWatch({ control });
  const fields = {
    name_uz: values.name_uz?.trim() || null,
    name_ru: values.name_ru?.trim() || null,
    department: values.department?.trim() || null,
    address: values.address?.trim() || null,
    contact: values.contact?.trim() || null,
    license: values.license?.trim() || null,
    stir: values.stir?.trim() || null,
  };
  const shortName = values.short_name?.trim() || fallbackName;

  return (
    <Section
      title={t("letterhead.preview.title")}
      description={t("letterhead.preview.intro")}
    >
      <div className="flex flex-col gap-4 rounded-sm border border-border bg-background p-5 shadow-sm">
        <p className="text-xs font-semibold text-muted-foreground">
          {t("letterhead.preview.first")}
        </p>
        <LetterheadFull
          fields={fields}
          logoUrl={logoUrl}
          fallbackName={fallbackName}
        />
        <p className="text-xs font-semibold text-muted-foreground">
          {t("letterhead.preview.next")}
        </p>
        <LetterheadRunning
          shortName={shortName}
          logoUrl={logoUrl}
          title={t("letterhead.preview.document")}
          aside={t("letterhead.preview.patient")}
        />
      </div>
      <StatusNote>{t("letterhead.preview.snapshot")}</StatusNote>
    </Section>
  );
}
