import Link from "next/link";
import { store } from "@/lib/auto-geo";

export const revalidate = 300;

export const metadata = {
  title: "Resources",
  description: "Guides and references published with auto-geo.",
};

export default async function ResourcesIndexPage() {
  const resources = await store.list();

  // Group by category.
  const byCategory = resources.reduce<Record<string, typeof resources>>(
    (acc, r) => {
      const list = acc[r.category] ?? [];
      list.push(r);
      acc[r.category] = list;
      return acc;
    },
    {}
  );

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-4xl font-semibold tracking-tight text-gray-900 mb-2">
        Resources
      </h1>
      <p className="text-base text-gray-500 mb-12">Published with auto-geo.</p>

      {Object.entries(byCategory).map(([category, items]) => (
        <section key={category} className="mb-12">
          <h2 className="text-xs font-mono uppercase tracking-wider text-gray-500 mb-4">
            {category}
          </h2>
          <ul className="space-y-6">
            {items.map((r) => (
              <li key={r.slug}>
                <Link href={`/resources/${r.slug}`} className="block group">
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {r.title}
                  </h3>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                    {r.excerpt}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {resources.length === 0 && (
        <p className="text-base text-gray-500">
          No resources published yet. POST to{" "}
          <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">
            /api/resources/publish
          </code>{" "}
          to add one.
        </p>
      )}
    </main>
  );
}
