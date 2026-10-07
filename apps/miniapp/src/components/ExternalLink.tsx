import { Fragment, type AnchorHTMLAttributes, type MouseEvent } from "react";

import { openExternalLink } from "../lib/telegram";

/**
 * Ссылка наружу — во внешний браузер через Telegram (`openExternalLink`).
 *
 * `href` остаётся настоящим: его читает программа чтения с экрана и долгое
 * нажатие «скопировать ссылку». Перехватывается только обычное нажатие.
 */
export function ExternalLink({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        openExternalLink(href);
      }}
    />
  );
}

/**
 * Адрес, который переносится только на границах частей: после «://», перед
 * «/» и точками.
 *
 * `break-all` рвал адрес где угодно — «http://localhost:51 / 75», и номер
 * порта читался как два числа. Без него длинный адрес не переносился бы вовсе
 * и распирал экран. `<wbr>` даёт переносу места, где разрыв не меняет смысла.
 */
export function BreakableUrl({ url }: { url: string }) {
  const parts = url.split(/(?<=:\/\/)|(?<=[^/:])(?=[/.?&])/);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  );
}
