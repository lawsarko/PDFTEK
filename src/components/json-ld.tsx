/** Structured data for search engines and AI assistants (schema.org JSON-LD). */
export function JsonLd({ data }: { data: object }) {
  // Escaping "<" keeps the JSON from closing the script tag early.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
