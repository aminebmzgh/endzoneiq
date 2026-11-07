import NextLink from "next/link";
import { useLocale } from "next-intl";
import type { ComponentProps } from "react";

/**
 * `next/link` with the current locale prefixed (every URL is /en, /fr or /es...).
 * A server component: the locale is resolved on the server, so next-intl's client
 * runtime (and its message formatter) never ships to the browser.
 */
export function Link({
  href,
  ...props
}: Omit<ComponentProps<typeof NextLink>, "href"> & { href: string }) {
  const locale = useLocale();
  return <NextLink href={href === "/" ? `/${locale}` : `/${locale}${href}`} {...props} />;
}
