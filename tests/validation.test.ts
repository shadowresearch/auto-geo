import { describe, it, expect } from "vitest";
import { auditResource } from "../core/validation";
import { VALID_PAYLOAD } from "./fixtures/payload";
import type { ResourcePublishPayload } from "../core/schema";

describe("auditResource", () => {
  it("returns warnings as an array", () => {
    const warnings = auditResource(VALID_PAYLOAD);
    expect(Array.isArray(warnings)).toBe(true);
  });

  describe("section heading heuristics", () => {
    it("warns when an H2 lacks a question mark", () => {
      const payload: ResourcePublishPayload = {
        ...VALID_PAYLOAD,
        sections: [
          {
            ...VALID_PAYLOAD.sections[0],
            heading: "A declarative six word heading here without question",
          },
        ],
      };
      const warnings = auditResource(payload);
      expect(
        warnings.some((w) => w.sop === "§3" && /question-format/.test(w.message))
      ).toBe(true);
    });

    it("warns when an H2 is too short", () => {
      const payload: ResourcePublishPayload = {
        ...VALID_PAYLOAD,
        sections: [
          {
            ...VALID_PAYLOAD.sections[0],
            heading: "Why short?",
          },
        ],
      };
      const warnings = auditResource(payload);
      expect(warnings.some((w) => w.sop === "§3")).toBe(true);
    });
  });

  describe("related guides self-link", () => {
    it("warns when related guides links back to the same slug", () => {
      const payload: ResourcePublishPayload = {
        ...VALID_PAYLOAD,
        slug: "self-link-page",
        relatedGuides: {
          items: [
            ...VALID_PAYLOAD.relatedGuides.items.slice(0, 3),
            {
              title: "Self",
              url: "https://example.com/resources/self-link-page",
            },
          ],
        },
      };
      const warnings = auditResource(payload);
      expect(warnings.some((w) => w.sop === "§5d")).toBe(true);
    });
  });

  describe("entity density", () => {
    it("warns when entity density is below 15", () => {
      // The fixture is short and likely has < 15 entities — this should fire.
      const warnings = auditResource(VALID_PAYLOAD);
      expect(warnings.some((w) => w.path === "entityDensity")).toBe(true);
    });
  });

  describe("page-type word counts", () => {
    it("flags a definitive page below 3000 words", () => {
      const payload: ResourcePublishPayload = {
        ...VALID_PAYLOAD,
        title: "What is a definitive guide?",
        geoMetadata: {
          ...VALID_PAYLOAD.geoMetadata,
          pageType: "definitive",
        },
      };
      const warnings = auditResource(payload);
      expect(
        warnings.some(
          (w) => w.path === "totalWords" && /definitive/.test(w.message)
        )
      ).toBe(true);
    });
  });

  describe("warning shape", () => {
    it("each warning has path and message", () => {
      const warnings = auditResource(VALID_PAYLOAD);
      for (const w of warnings) {
        expect(typeof w.path).toBe("string");
        expect(typeof w.message).toBe("string");
        if (w.sop !== undefined) {
          expect(typeof w.sop).toBe("string");
        }
      }
    });
  });
});
