import { zodResolver } from "@hookform/resolvers/zod";
import {
  Avatar,
  AvatarFallback,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  toast,
} from "@ketocare/ui";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FormError } from "../../components/FormError";
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

  if (me.isPending) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (me.error !== null || !me.data) {
    return (
      <FormError>
        {errorMessageOf(me.error) ?? t("common:errors.unexpected")}
      </FormError>
    );
  }

  const profile = me.data;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback className="text-base">
            {initialsOf(profile.full_name)}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="m-0 text-xl font-semibold">{profile.full_name}</h1>
          <p className="m-0 text-sm text-muted-foreground">
            {t(`common:roles.${profile.role}`)} · {profile.email}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("card.title")}</CardTitle>
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
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="profile-name">{t("fields.fullName")}</Label>
              <Input
                id="profile-name"
                autoComplete="name"
                aria-invalid={errors.fullName ? true : undefined}
                {...register("fullName")}
              />
              {errors.fullName && (
                <p className="text-sm text-destructive">
                  {t("errors.fullName")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-phone">{t("fields.phone")}</Label>
              <Input
                id="profile-phone"
                type="tel"
                autoComplete="tel"
                {...register("phone")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-email">{t("fields.email")}</Label>
              <Input
                id="profile-email"
                value={profile.email}
                readOnly
                disabled
              />
              <p className="text-sm text-muted-foreground">{t("emailHint")}</p>
            </div>

            {update.error !== null && (
              <FormError>
                {errorMessageOf(update.error) ?? t("common:errors.unexpected")}
              </FormError>
            )}

            <Button type="submit" disabled={update.isPending}>
              {update.isPending
                ? t("common:actions.saving")
                : t("common:actions.save")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
