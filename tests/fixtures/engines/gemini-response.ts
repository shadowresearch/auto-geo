/**
 * Canned Gemini generateContent body for a `google_search`-grounded
 * call. Includes the characteristic Google redirect URIs on
 * `groundingChunks[].web.uri` plus a real-host title we can recover
 * via the adapter's `inferUrlFromTitle` heuristic.
 */
export const geminiSampleResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: "Generative engine optimization (GEO) is the practice of structuring web pages so AI search engines cite them.",
          },
        ],
        role: "model",
      },
      finishReason: "STOP",
      groundingMetadata: {
        webSearchQueries: ["what is GEO", "generative engine optimization"],
        groundingChunks: [
          {
            web: {
              uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf1",
              title: "shadow.inc",
            },
          },
          {
            web: {
              uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf2",
              title: "GEO explained - searchengineland.com",
            },
          },
        ],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 80, text: "Generative…" },
            groundingChunkIndices: [0, 1],
          },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 50,
    candidatesTokenCount: 120,
    totalTokenCount: 170,
  },
} as const;
