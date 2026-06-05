/**
 * Canned xAI chat-completions body for a Live Search call. Citations
 * are returned as a flat URL list on `choices[0].message`. We also
 * include the `num_sources_used` usage field that the adapter prefers
 * over citation count for cost estimation.
 */
export const xaiSampleResponse = {
  id: "chatcmpl_test_001",
  object: "chat.completion",
  created: 1717977600,
  model: "grok-2-latest",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content:
          "Generative engine optimization (GEO) is structuring content for AI search engines to cite.",
        citations: [
          "https://www.shadow.inc/resources/what-is-geo",
          "https://github.com/shadowresearch/auto-geo",
          "https://searchengineland.com/geo-explained",
          // Duplicate — adapter must dedupe.
          "https://www.shadow.inc/resources/what-is-geo",
        ],
      },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 80,
    completion_tokens: 150,
    total_tokens: 230,
    num_sources_used: 3,
  },
} as const;
