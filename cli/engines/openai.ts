import type {
  Engine,
  EngineFactoryOptions,
  EngineResponse,
  CitedSource,
} from "./types";

/**
 * OpenAI grounded-search adapter — STUB for v0.1.4.
 *
 * Real implementation will use the Responses API with the
 * `web_search_preview` tool, where citations come back as
 * `url_citation` annotations attached to message output items.
 *
 * Reference: https://platform.openai.com/docs/guides/tools-web-search
 *
 * For v0.1.4 we ship Perplexity end-to-end and leave this scaffold in
 * place so a follow-up PR can fill it without touching the CLI surface.
 * `--engine openai` therefore throws a clear "not yet implemented"
 * error; `--engine all` skips it until this lands.
 */

const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Shape of the Responses-API output items we'd parse. Kept here so the
 * follow-up PR has a typed target and the test scaffolding can mock
 * against it without guessing at field names.
 */
export type OpenAIResponsesOutput = {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{
        type?: string; // "url_citation"
        url?: string;
        title?: string;
        start_index?: number;
        end_index?: number;
      }>;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export function createOpenAIEngine(opts: EngineFactoryOptions = {}): Engine {
  const model = opts.model ?? DEFAULT_MODEL;
  // Resolved here (not inside `askWithCitations`) so the future
  // implementation already has the values; today they're unused
  // because we throw immediately.
  void opts.apiKey;
  void opts.fetch;

  return {
    name: "openai",
    model,
    async askWithCitations(_query: string): Promise<EngineResponse> {
      throw new Error(
        "OpenAI engine is not yet implemented. Track progress at https://github.com/shadowresearch/auto-geo/issues — use `--engine perplexity` (default) for now."
      );
    },
  };
}

/**
 * Exported for the follow-up PR's tests. Walks the Responses-API
 * output tree and extracts `url_citation` annotations. Stable enough
 * to land now; the only piece still missing is the HTTP call itself.
 */
export function parseOpenAICitations(
  data: OpenAIResponsesOutput
): CitedSource[] {
  const out: CitedSource[] = [];
  for (const item of data.output ?? []) {
    for (const c of item.content ?? []) {
      for (const a of c.annotations ?? []) {
        if (a.type === "url_citation" && a.url) {
          out.push({ url: a.url, title: a.title });
        }
      }
    }
  }
  return dedupeByUrl(out);
}

function dedupeByUrl(citations: CitedSource[]): CitedSource[] {
  const seen = new Set<string>();
  const out: CitedSource[] = [];
  for (const c of citations) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}
