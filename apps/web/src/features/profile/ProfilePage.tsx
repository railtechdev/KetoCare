import { zodResolver } from "@hookform/resolvers/zod";
import {
  AsyncSection,
  Avatar,
  AvatarFallback,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormFooter,
  Skeleton,
  toast,
} from "@ketocare/ui";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { useMe } from "../auth/useMe";
import { initialsOf } from "../../layouts/initials";
import { useUpdateProfileMutation } from "./useProfile";

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  phone: z.string().max(32),
});

type ProfileValues = z.infer<typeof profileSchema>;

/**
 * Свой профиль.
 *
 * Почта не редактируется: она же логин, и её смена — отдельная процедура с
 * подтверждением владения адресом. Роль тоже: повышать себе права нельзя.
 * Оба поля показаны, чтобы пользователь видел, под кем работает.
 */
export function ProfilePage() {
  const { t } = useTranslation("profile");
  const me = useMe();
  const update = useUpdateProfileMutation();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: "", phone: "" },
  });

  // Форма заполняется, когда профиль пришёл: значения по умолчанию считываются
  // один раз при монтировании, а запрос к этому моменту ещё не завершён.
  useEffect(() => {
    if (me.data) {
      reset({ fullName: me.data.full_name, phone: me.data.phone ?? "" });
    }
  }, [me.data, reset]);

  const profile = me.data;

  return (
    <PageLayout
      title={t("title")}
      width="form"
      actions={
        profile === undefined ? undefined : (
          <Avatar className="size-14">
            <AvatarFallback className="text-base">
              {initialsOf(profile.full_name)}
            </AvatarFallback>
          </Avatar>
        )
      }
      intro={
        profile === undefined
          ? undefined
          : t("subtitle", {
              role: t(`common:roles.${profile.role}`),
              email: profile.email,
            })
      }
    >
      {/* Четыре состояния — в AsyncSection: неудачное обновление профиля не
          должно прятать форму вместе с тем, что пользователь в неё уже ввёл. */}
      <AsyncSection
        loading={me.isLoading}
        skeleton={
          <div
            className="flex flex-col gap-block"
            role="status"
            aria-busy="true"
          >
            <Skeleton className="h-14 w-56" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        }
        error={
          me.isError
            ? {
                title: t("loadError"),
                description:
                  errorMessageOf(me.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void me.refetch()}
        isEmpty={profile === undefined}
        empty={null}
      >
        {profile !== undefined && (
          <Card>
            <CardHeader>
              <CardTitle className="text-card-title">
                {t("card.title")}
              </CardTitle>
              <CardDescription>{t("card.intro")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleSubmit((values) => {
                  update.mutate(
                    {
                      full_name: values.fullName,
                      phone:
                        values.phone.trim() === "" ? null : values.phone.trim(),
                    },
                    { onSuccess: () => toast.success(t("saved")) },
                  );
                })}
                noValidate
                className="flex flex-col gap-block"
              >
                <Field
                  id="profile-name"
                  autoComplete="name"
                  label={t("fields.fullName")}
                  error={errors.fullName && t("errors.fullName")}
                  {...register("fullName")}
                />

                <Field
                  id="profile-phone"
                  type="tel"
                  autoComplete="tel"
                  optional
                  label={t("fields.phone")}
                  {...register("phone")}
                />

                <Field
                  id="profile-email"
                  type="email"
                  label={t("fields.email")}
                  hint={t("emailHint")}
                  value={profile.email}
                  readOnly
                  disabled
                />

                {update.error !== null && (
                  <FormError>
                    {errorMessageOf(update.error) ??
                      t("common:errors.unexpected")}
                  </FormError>
                )}

                <FormFooter
                  submitLabel={t("common:actions.save")}
                  pendingLabel={t("common:actions.saving")}
                  pending={update.isPending}
                />
              </form>
            </CardContent>
          </Card>
        )}
      </AsyncSection>
    </PageLayout>
  );
}
