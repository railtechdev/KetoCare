import { cn } from "@ketocare/ui";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  recipeId: string;
  /**
   * `photo_path` рецепта: идентификатор вложения либо `null`.
   *
   * Само значение в адрес не подставляется — по нему только видно, есть ли
   * фото вообще. Адрес собирается из идентификатора рецепта: в базе лежит
   * ссылка на вложение, а не готовый URL, чтобы префикс `/api/v1` не оказался
   * вшит в строки таблицы (ADR-0013, решение 7).
   */
  photoPath: string | null;
  className?: string;
}

/**
 * Фото рецепта с запасным блоком.
 *
 * Путь приходит из базы и может указывать на ещё не загруженный файл, поэтому
 * недоступное изображение заменяется подписью: сломанная картинка в списке
 * выглядит как поломка экрана.
 *
 * Изображение декоративное (alt пустой): название рецепта стоит рядом, и
 * скринридер иначе прочитал бы его дважды.
 */
export function RecipePhoto({ recipeId, photoPath, className }: Props) {
  const { t } = useTranslation("recipes");
  // Запоминается КАКОЕ фото не загрузилось, а не факт неудачи: после замены
  // фото признак «сломано» иначе пережил бы новую картинку, и загруженное
  // только что показывалось бы заглушкой.
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);

  // Куку браузер приложит сам: кабинет аутентифицируется httpOnly-cookie
  // (раздел 5.2 ТЗ), и ручного fetch с токеном здесь не нужно. Идентификатор
  // вложения в адресе — чтобы браузер не отдал закешированное прежнее фото.
  const src = `/api/v1/recipes/${recipeId}/photo?v=${photoPath ?? ""}`;
  const usable =
    photoPath !== null && photoPath !== "" && failedPhoto !== photoPath;

  if (!usable) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-field bg-muted text-sm text-muted-foreground",
          className,
        )}
      >
        <ImageOff aria-hidden="true" className="size-5" />
        <span>{t("card.noPhoto")}</span>
      </div>
    );
  }

  return (
    <img
      key={photoPath}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailedPhoto(photoPath)}
      className={cn("object-cover", className)}
    />
  );
}
