import { Button, Section, toast } from "@ketocare/ui";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api, errorMessageOf } from "../../lib/api";

/** Снова спрашивать код на всех устройствах, которые вы просили запомнить. */
export function TrustedDevicesSection() {
  const { t } = useTranslation("auth");
  const forget = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/api/v1/auth/trusted-devices/forget",
        {},
      );
      if (error) throw error;
    },
    onSuccess: () => toast.success(t("trustedDevices.forgotten")),
    onError: (error) =>
      toast.error(errorMessageOf(error) ?? t("common:errors.unexpected")),
  });

  return (
    <Section title={t("trustedDevices.title")}>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={forget.isPending}
          onClick={() => forget.mutate()}
        >
          {t("trustedDevices.forget")}
        </Button>
      </div>
    </Section>
  );
}
