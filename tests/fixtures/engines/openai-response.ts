/**
 * Canned OpenAI Responses-API body for `web_search_preview` calls.
 * Trimmed from a real response down to the surface our adapter
 * consumes. Re-used across the OpenAI engine + multi-engine tests.
 */
export const openaiSampleResponse = {
  id: "resp_test_001",
  type: "response",
  status: "completed",
  output: [
    {
      type: "web_search_call",
      id: "ws_test_001",
      status: "completed",
      action: { type: "search", query: "what is GEO" },
    },
    {
      // Second web_search_call to assert dedupe + ordering on the
      // parsed fanOutQueries.
      type: "web_search_call",
      id: "ws_test_002",
      status: "completed",
      action: { type: "search", query: "generative engine optimization" },
    },
    {
      // Duplicate of the first call — must be deduped by the parser.
      type: "web_search_call",
      id: "ws_test_003",
      status: "completed",
      action: { type: "search", query: "what is GEO" },
    },
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: "GEO (generative engine optimization) is the practice of structuring web content so that AI search engines surface and cite it.",
          annotations: [
            {
              type: "url_citation",
              start_index: 0,
              end_index: 30,
              url: "https://www.shadow.inc/resources/what-is-geo",
              title: "What is GEO? — Shadow",
            },
            {
              type: "url_citation",
              start_index: 31,
              end_index: 90,
              url: "https://arxiv.org/abs/2311.09735",
              title: "GEO: Generative Engine Optimization (arXiv)",
            },
            // Dedup target — same URL appears twice in the upstream.
            {
              type: "url_citation",
              start_index: 91,
              end_index: 110,
              url: "https://www.shadow.inc/resources/what-is-geo",
              title: "What is GEO? — Shadow (cached)",
            },
          ],
        },
      ],
    },
  ],
  usage: {
    input_tokens: 120,
    output_tokens: 240,
    total_tokens: 360,
  },
} as const;
