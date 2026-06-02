import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runPublish, runDelete, type PublishOptions } from "../../core/publish";

/**
 * Next.js App Router handlers for `/api/resources/publish`.
 *
 * Usage (in `app/api/resources/publish/route.ts`):
 *
 *   import { createNextHandlers } from "auto-geo/next";
 *   import { createKvStore } from "auto-geo/storage/kv";
 *
 *   const handlers = createNextHandlers({
 *     store: createKvStore(),
 *     site: {
 *       origin: "https://example.com",
 *       publisher: {
 *         name: "Acme",
 *         url: "https://example.com",
 *         logo: "https://example.com/logo.png",
 *       },
 *     },
 *     reservedSlugs: STATIC_SLUGS,
 *   });
 *
 *   export const POST = handlers.POST;
 *   export const DELETE = handlers.DELETE;
 *
 * Auth: the handler reads `GEO_PUBLISH_TOKEN` from env and expects an
 * `Authorization: Bearer <token>` header. Configure the env var
 * separately for preview and production deployments.
 *
 * Revalidation: on a successful publish or delete, the handler calls
 * `revalidatePath(basePath)` and `revalidatePath(\`\${basePath}/\${slug}\`)`
 * so the index and slug page appear immediately without waiting for ISR.
 */

export type NextHandlerOptions = PublishOptions & {
  /**
   * Override the env var name. Defaults to `GEO_PUBLISH_TOKEN`.
   * Useful if you have multiple auto-geo instances on the same backend.
   */
  tokenEnv?: string;
};

function authorize(
  request: NextRequest,
  envName: string
): "ok" | "no-token" | "unauthorized" {
  const expected = process.env[envName];
  if (!expected) return "no-token";
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return "unauthorized";
  const provided = header.slice("Bearer ".length).trim();
  return provided === expected ? "ok" : "unauthorized";
}

export function createNextHandlers(opts: NextHandlerOptions) {
  const tokenEnv = opts.tokenEnv ?? "GEO_PUBLISH_TOKEN";
  const basePath = opts.site.basePath ?? "/resources";

  async function POST(request: NextRequest) {
    const auth = authorize(request, tokenEnv);
    if (auth === "no-token") {
      console.error(`auto-geo: ${tokenEnv} is not configured.`);
      return NextResponse.json(
        { error: "Server configuration error." },
        { status: 500 }
      );
    }
    if (auth === "unauthorized") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const result = await runPublish(body, opts);

    switch (result.kind) {
      case "validation_failed":
        return NextResponse.json(
          { error: "Validation failed.", issues: result.issues },
          { status: 400 }
        );
      case "slug_reserved":
        return NextResponse.json(
          {
            error: `Slug "${result.slug}" is reserved by a static page and cannot be overwritten via this API.`,
          },
          { status: 409 }
        );
      case "store_failed":
        console.error("auto-geo: store.publish threw:", result.error);
        return NextResponse.json(
          { error: "Failed to publish resource." },
          { status: 502 }
        );
      case "ok":
        revalidatePath(basePath);
        revalidatePath(`${basePath}/${result.slug}`);
        return NextResponse.json({
          success: true,
          slug: result.slug,
          url: result.url,
          warnings: result.warnings,
        });
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }

  async function DELETE(request: NextRequest) {
    const auth = authorize(request, tokenEnv);
    if (auth === "no-token") {
      return NextResponse.json(
        { error: "Server configuration error." },
        { status: 500 }
      );
    }
    if (auth === "unauthorized") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const slug = new URL(request.url).searchParams.get("slug");
    if (!slug) {
      return NextResponse.json(
        { error: "Missing `slug` query parameter." },
        { status: 400 }
      );
    }

    const result = await runDelete(slug, opts);
    switch (result.kind) {
      case "slug_reserved":
        return NextResponse.json(
          {
            error: `Slug "${result.slug}" is reserved by a static page and cannot be deleted via this API.`,
          },
          { status: 409 }
        );
      case "not_found":
        return NextResponse.json(
          { error: "Resource not found." },
          { status: 404 }
        );
      case "store_failed":
        console.error("auto-geo: store.delete threw:", result.error);
        return NextResponse.json(
          { error: "Failed to delete resource." },
          { status: 502 }
        );
      case "ok":
        revalidatePath(basePath);
        revalidatePath(`${basePath}/${result.slug}`);
        return NextResponse.json({ success: true, slug: result.slug });
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }

  return { POST, DELETE };
}
