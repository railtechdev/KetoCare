import { cn } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  /** `photo_path` рецепта как его отдаёт сервер */
  src: string | null;
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
export function RecipePhoto({ src, className }: Props) {
  const { t } = useTranslation("recipes");
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const usable = src !== null && src !== "" && failedSrc !== src;

  if (!usable) {
    // span, а не div: карточка списка целиком является кнопкой, а внутрь кнопки
    // по HTML допускается только фразовое содержимое.
    return (
      <span
        className={cn(
          "flex items-center justify-center bg-canvas text-sm text-muted",
          className,
        )}
      >
        {t("card.noPhoto")}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailedSrc(src)}
      className={cn("object-cover", className)}
    />
  );
}
