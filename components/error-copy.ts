/**
 * Copy for the error boundaries. They are client components that render when the
 * server tree failed, so they can't use next-intl's server translations, and shipping
 * the message catalogs to every browser for this would be wasteful (same reason as
 * lib/notify/copy.ts). tests/legal-content.test.ts checks every locale is present.
 */
export const ERROR_COPY = {
  en: {
    title: "Something went wrong on our side.",
    body: "The error has been reported. Try again, or come back in a few minutes.",
    retry: "Try again",
    home: "Back to this week's picks",
  },
  fr: {
    title: "Un problème est survenu de notre côté.",
    body: "L'erreur a été signalée. Réessayez, ou revenez dans quelques minutes.",
    retry: "Réessayer",
    home: "Retour aux pronostics de la semaine",
  },
  es: {
    title: "Algo ha fallado por nuestra parte.",
    body: "Hemos registrado el error. Vuelve a intentarlo o regresa en unos minutos.",
    retry: "Reintentar",
    home: "Volver a los pronósticos de la semana",
  },
} as const;

export type ErrorLocale = keyof typeof ERROR_COPY;

export function errorCopy(locale: string | undefined) {
  return ERROR_COPY[(locale && locale in ERROR_COPY ? locale : "en") as ErrorLocale];
}
