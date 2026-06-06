import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildSanitizedResourceJsonSchema,
  OPENAI_STRUCTURED_OUTPUT_STRING_FORMATS,
  sanitizeJsonSchemaForProviders,
} from "../cli/llm";
import { resourcePublishSchema } from "../core/schema";

/**
 * Tests for the v0.5.1 bug fix: `auto-geo write` + `auto-geo fix`
 * crashed on every OpenAI invocation with
 *   "Invalid schema for response_format 'response': … 'uri' is not a
 *    valid format."
 *
 * Root cause: `zod-to-json-schema` emits `format: "uri"` for every
 * `z.string().url()` field in `resourcePublishSchema`. OpenAI's strict
 * structured-output validator only accepts a narrow allowlist of string
 * formats; `"uri"` is not on it.
 *
 * Fix: sanitize the JSON Schema before handing it to `generateObject`.
 * URL validation still happens — we re-run `resourcePublishSchema`
 * against the model output (see `cli/llm.ts → generateResourcePayload`).
 */

// ── Helpers ────────────────────────────────────────────────────────

type Visitor = (node: Record<string, unknown>) => void;

/**
 * Walk every object node in a JSON-Schema-shaped value. Mirrors the
 * traversal in `sanitizeJsonSchemaForProviders` so we have an
 * independent check that no `format` escapes the sanitizer.
 */
function walkAllNodes(node: unknown, visit: Visitor): void {
  if (Array.isArray(node)) {
    for (const item of node) walkAllNodes(item, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  visit(obj);
  for (const value of Object.values(obj)) walkAllNodes(value, visit);
}

function collectFormats(node: unknown): string[] {
  const formats: string[] = [];
  walkAllNodes(node, (n) => {
    if (typeof n.format === "string") formats.push(n.format);
  });
  return formats;
}

// ── buildSanitizedResourceJsonSchema (the real-bug verification) ──

describe("buildSanitizedResourceJsonSchema", () => {
  it('emits zero `format: "uri"` entries anywhere (the v0.5.1 bug)', () => {
    const sanitized = buildSanitizedResourceJsonSchema();
    const formats = collectFormats(sanitized);
    expect(formats).not.toContain("uri");
    // Belt-and-suspenders: also catch `url`, which some converters use.
    expect(formats).not.toContain("url");
  });

  it("contains no formats outside the OpenAI strict-mode allowlist", () => {
    const sanitized = buildSanitizedResourceJsonSchema();
    const formats = collectFormats(sanitized);
    for (const fmt of formats) {
      expect(OPENAI_STRUCTURED_OUTPUT_STRING_FORMATS.has(fmt)).toBe(true);
    }
  });

  it("does NOT mutate the original `resourcePublishSchema`", () => {
    // Re-converting the original schema after sanitization should still
    // produce `format: "uri"` — proving we didn't mutate the Zod schema.
    buildSanitizedResourceJsonSchema();
    const fresh = z.toJSONSchema(
      resourcePublishSchema as unknown as z.ZodType,
      { unrepresentable: "any" }
    );
    expect(collectFormats(fresh)).toContain("uri");
  });
});

// ── sanitizeJsonSchemaForProviders (unit) ─────────────────────────

describe("sanitizeJsonSchemaForProviders", () => {
  it('strips `format: "uri"` at the root', () => {
    const out = sanitizeJsonSchemaForProviders({
      type: "string",
      format: "uri",
    });
    expect(out).toEqual({ type: "string" });
  });

  it("passes allowlisted formats through unchanged", () => {
    const input = {
      type: "object",
      properties: {
        email: { type: "string", format: "email" },
        when: { type: "string", format: "date-time" },
        date: { type: "string", format: "date" },
        id: { type: "string", format: "uuid" },
        ip4: { type: "string", format: "ipv4" },
        ip6: { type: "string", format: "ipv6" },
        host: { type: "string", format: "hostname" },
        elapsed: { type: "string", format: "duration" },
        ts: { type: "string", format: "time" },
      },
    };
    const out = sanitizeJsonSchemaForProviders(input);
    expect(out).toEqual(input);
  });

  it("strips unsupported formats other than `uri`", () => {
    const input = {
      type: "object",
      properties: {
        web: { type: "string", format: "uri" },
        // Common non-allowlisted formats zod-to-json-schema and friends
        // can emit. None of these belong in an OpenAI strict schema.
        regex: { type: "string", format: "regex" },
        b64: { type: "string", format: "base64" },
        json: { type: "string", format: "json" },
        ref: { type: "string", format: "uri-reference" },
        ctype: { type: "string", format: "uri-template" },
        somethingNew: { type: "string", format: "color" },
      },
    };
    const out = sanitizeJsonSchemaForProviders(input) as {
      properties: Record<string, Record<string, unknown>>;
    };
    for (const key of Object.keys(input.properties)) {
      expect(out.properties[key]).toEqual({ type: "string" });
    }
  });

  it("walks `properties`, `items`, `oneOf`, `anyOf`, `allOf`, `$defs`, `definitions`, `additionalProperties`, `patternProperties`, `not`", () => {
    const input = {
      type: "object",
      properties: {
        a: { type: "string", format: "uri" },
        b: {
          type: "array",
          items: { type: "string", format: "uri" },
        },
        c: {
          oneOf: [
            { type: "string", format: "uri" },
            { type: "string", format: "email" },
          ],
        },
        d: {
          anyOf: [{ type: "string", format: "uri" }],
        },
        e: {
          allOf: [{ type: "string", format: "uri" }],
        },
        f: {
          additionalProperties: { type: "string", format: "uri" },
        },
        g: {
          patternProperties: {
            "^x": { type: "string", format: "uri" },
          },
        },
        h: { not: { type: "string", format: "uri" } },
      },
      $defs: {
        ref1: { type: "string", format: "uri" },
      },
      definitions: {
        ref2: { type: "string", format: "uri" },
      },
    };
    const out = sanitizeJsonSchemaForProviders(input);
    const formats = collectFormats(out);
    expect(formats).not.toContain("uri");
    // The one allowlisted format inside `oneOf` survives.
    expect(formats).toContain("email");
  });

  it("does not mutate the input", () => {
    const input: Record<string, unknown> = {
      type: "string",
      format: "uri",
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    sanitizeJsonSchemaForProviders(input);
    expect(input).toEqual(snapshot);
  });

  it("accepts a custom allowlist", () => {
    const out = sanitizeJsonSchemaForProviders(
      { type: "string", format: "uri" },
      new Set(["uri"])
    );
    expect(out).toEqual({ type: "string", format: "uri" });
  });

  it("handles primitives and null without throwing", () => {
    expect(sanitizeJsonSchemaForProviders(null)).toBeNull();
    expect(sanitizeJsonSchemaForProviders(42)).toBe(42);
    expect(sanitizeJsonSchemaForProviders("hello")).toBe("hello");
    expect(sanitizeJsonSchemaForProviders(true)).toBe(true);
  });
});

// ── OPENAI_STRUCTURED_OUTPUT_STRING_FORMATS ───────────────────────

describe("OPENAI_STRUCTURED_OUTPUT_STRING_FORMATS", () => {
  it("matches the documented allowlist", () => {
    // https://platform.openai.com/docs/guides/structured-outputs#supported-schemas
    expect([...OPENAI_STRUCTURED_OUTPUT_STRING_FORMATS].sort()).toEqual(
      [
        "date",
        "date-time",
        "duration",
        "email",
        "hostname",
        "ipv4",
        "ipv6",
        "time",
        "uuid",
      ].sort()
    );
  });

  it("does NOT include `uri` — the format that caused the v0.5.1 bug", () => {
    expect(OPENAI_STRUCTURED_OUTPUT_STRING_FORMATS.has("uri")).toBe(false);
  });
});
