/**
 * Canned Claude Messages-API body for a `web_search_20250305` call.
 * Mirrors the shape documented at
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 * trimmed to the surface our adapter consumes.
 */
export const anthropicSampleResponse = {
  id: "msg_test_001",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5",
  stop_reason: "end_turn",
  content: [
    {
      type: "text",
      text: "I'll search for what GEO means in the context of AI search.",
    },
    {
      type: "server_tool_use",
      id: "srvtoolu_test_001",
      name: "web_search",
      input: { query: "what is generative engine optimization" },
    },
    {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_test_001",
      content: [
        {
          type: "web_search_result",
          url: "https://www.shadow.inc/resources/what-is-geo",
          title: "What is GEO? — Shadow",
          encrypted_content: "EqgfCioIARgB...",
          page_age: "April 1, 2025",
        },
        {
          type: "web_search_result",
          url: "https://searchengineland.com/geo-explained",
          title: "GEO explained — Search Engine Land",
          encrypted_content: "EqhfDioIBRgC...",
          page_age: "March 12, 2025",
        },
      ],
    },
    {
      type: "text",
      text: "Generative engine optimization (GEO) is the practice of structuring content so AI search engines cite it as a source.",
      citations: [
        {
          type: "web_search_result_location",
          url: "https://www.shadow.inc/resources/what-is-geo",
          title: "What is GEO? — Shadow (inline)",
          encrypted_index: "Eo8BCioIAhgB...",
          cited_text:
            "Generative engine optimization (GEO) is the practice of structuring content so AI search engines cite it.",
        },
      ],
    },
  ],
  usage: {
    input_tokens: 6039,
    output_tokens: 931,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    server_tool_use: { web_search_requests: 1 },
  },
} as const;
