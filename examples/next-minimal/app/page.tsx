import Link from "next/link";

export default function HomePage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-16">
      <p className="text-xs font-mono uppercase tracking-wider text-gray-500 mb-3">
        Built by{" "}
        <a
          href="https://www.shadow.inc"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-900 transition-colors"
        >
          Shadow
        </a>
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-gray-900 mb-4">
        auto-geo example
      </h1>
      <p className="text-base text-gray-600 leading-relaxed mb-8">
        This is a reference Next.js app integrating <code>auto-geo</code>. The{" "}
        <Link href="/resources" className="text-blue-600 hover:underline">
          /resources
        </Link>{" "}
        index lists everything in the seeded in-memory store. POST a payload to{" "}
        <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">
          /api/resources/publish
        </code>{" "}
        with{" "}
        <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">
          Authorization: Bearer $GEO_PUBLISH_TOKEN
        </code>{" "}
        to add a new one.
      </p>
      <p className="text-sm text-gray-500">
        See <code>README.md</code> for swap-to-KV and swap-to-Supabase
        instructions, and the{" "}
        <a
          href="https://github.com/shadowresearch/auto-geo"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          auto-geo repo
        </a>{" "}
        for the full project.
      </p>
    </main>
  );
}
