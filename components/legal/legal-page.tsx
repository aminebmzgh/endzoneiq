import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { type Block, DOC_PATHS, type DocId, fill, LEGAL_CONTENT } from "@/content/legal";
import type { Locale } from "@/i18n/routing";
import { pageMetadata } from "@/lib/site/seo";

export function legalMetadata(locale: Locale, id: DocId): Metadata {
  const doc = LEGAL_CONTENT[locale].docs[id];
  return pageMetadata({
    locale,
    path: DOC_PATHS[id],
    title: doc.title,
    description: doc.description,
  });
}

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

/** [text](href) and **bold**. Hrefs starting with "/" get the locale prefix. */
export function inline(text: string, locale: Locale): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (m[3] !== undefined) {
      out.push(<strong key={key}>{m[3]}</strong>);
    } else {
      const href = m[2].startsWith("/") ? `/${locale}${m[2]}` : m[2];
      const external = href.startsWith("http");
      out.push(
        <a
          key={key}
          href={href}
          className="text-accent underline underline-offset-4"
          {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
        >
          {m[1]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function BlockView({ block, locale }: { block: Block; locale: Locale }) {
  if (Array.isArray(block)) {
    return (
      <ul className="list-disc space-y-2 pl-5">
        {block.map((item, i) => (
          <li key={i}>{inline(fill(item, locale), locale)}</li>
        ))}
      </ul>
    );
  }
  return <p>{inline(fill(block, locale), locale)}</p>;
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A static, prerendered document page (terms, privacy, about...). */
export function LegalPage({ locale, id }: { locale: Locale; id: DocId }) {
  const content = LEGAL_CONTENT[locale];
  const doc = content.docs[id];
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-balance">{doc.title}</h1>
        <p className="mt-3 text-pretty text-muted-foreground">{doc.description}</p>
        <p className="mt-2 text-sm text-muted-foreground">{fill(content.updated, locale)}</p>
      </header>
      {doc.sections.length > 4 && (
        <nav aria-labelledby="toc" className="mb-8 rounded-lg border border-border bg-card p-4">
          <h2 id="toc" className="text-sm font-semibold">
            {content.contents}
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {doc.sections.map((s) => (
              <li key={s.heading}>
                <a href={`#${slug(s.heading)}`} className="hover:underline">
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="space-y-8 leading-relaxed">
        {doc.sections.map((s) => (
          <section key={s.heading} aria-labelledby={slug(s.heading)}>
            <h2 id={slug(s.heading)} className="mb-3 scroll-mt-4 text-xl font-semibold">
              {s.heading}
            </h2>
            <div className="space-y-3 text-pretty">
              {s.body.map((b, i) => (
                <Fragment key={i}>
                  <BlockView block={b} locale={locale} />
                </Fragment>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
