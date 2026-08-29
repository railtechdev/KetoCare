import { cn } from "@ketocare/ui";
import { ImageOff } from "lucide-react";
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
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailedSrc(src)}
      className={cn("object-cover", className)}
    />
  );
}
