import QRCode from "qrcode";
import { useEffect, useState } from "react";

/**
 * QR-код из строки, которую построил сервер.
 *
 * Общий компонент, а не вторая копия: рисовать QR нужно в двух местах — при
 * настройке второго фактора и при выдаче доступа семье, — и разъехаться они
 * могут молча: размер, поле вокруг, уровень коррекции и подпись для
 * скринридера видны только глазами.
 *
 * `alt` обязателен и обязан содержать то же, что закодировано: человек, который
 * QR не видит (скринридер, чёрно-белая распечатка, камера не читает), должен
 * получить ту же строку словами.
 */
export function QrCode({
  value,
  alt,
  className,
}: {
  value: string;
  alt: string;
  className?: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // `toString`, а не `toDataURL`: SVG масштабируется без мыла на экране врача,
    // который подносит телефон родителя вплотную.
    void QRCode.toString(value, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((markup) => {
        if (alive) setSvg(markup);
      })
      .catch(() => {
        // Молча: рядом всегда стоит сам код и ссылка, и отсутствие картинки не
        // делает экран нерабочим.
        if (alive) setSvg(null);
      });
    return () => {
      alive = false;
    };
  }, [value]);

  if (svg === null) return null;

  return (
    <div
      className={
        className ??
        "flex justify-center [&_svg]:size-44 [&_svg]:rounded-md [&_svg]:bg-white [&_svg]:p-2"
      }
      role="img"
      aria-label={alt}
      // Разметку построила локально библиотека qrcode из строки, полученной от
      // нашего API, — это не пользовательский ввод.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
