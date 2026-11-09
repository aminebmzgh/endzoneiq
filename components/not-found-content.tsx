import { Link } from "@/components/locale-link";

/** The 404 body, inside the localized layout (header and footer stay in place). */
export function NotFoundContent({
  code,
  title,
  body,
  links,
}: {
  code: string;
  title: string;
  body: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:py-24">
      <p className="font-mono text-sm text-accent">{code}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h1>
      <p className="mt-4 text-pretty text-muted-foreground">{body}</p>
      <ul className="mt-6 flex flex-wrap gap-3">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              prefetch={false}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
