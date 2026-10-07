import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

/**
 * Шаг входа, чей краткоживущий токен истёк: настройка второго фактора или
 * задание своего пароля после временного.
 *
 * Токен шага живёт минуты, а человек мог отойти от экрана. Прежде истечение
 * показывалось общим «Что-то пошло не так» под полем, и выхода из шага не было:
 * повтор с тем же токеном отказывал снова, а форма входа пряталась за шагом
 * до перезагрузки страницы. Шаг — состояние, а не ошибка (правило П38): здесь
 * говорится, что случилось, и стоит единственное действие, которое поможет.
 */
export function StepExpired({ onRestart }: { onRestart: () => void }) {
  const { t } = useTranslation("auth");

  return (
    <div className="flex min-h-dvh items-center justify-center p-screen">
      <Card className="w-full max-w-form">
        <CardHeader>
          <CardTitle className="text-page-title">
            <h1 className="m-0 font-semibold">{t("stepExpired.title")}</h1>
          </CardTitle>
          <CardDescription>{t("stepExpired.body")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" className="min-h-touch" onClick={onRestart}>
            {t("stepExpired.restart")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
