export {
  resourcePublishSchema,
  wordCount,
  type ResourcePublishPayload,
  type ResourceAuthor,
  type ResourceEntityRef,
  type ResourceCitation,
  type ResourceContentBlock,
  type ResourceContentSection,
  type ResourceParagraphBlock,
  type ResourceH3Block,
  type ResourceListBlock,
  type ResourceTableBlock,
  type ResourceQuoteBlock,
  type ResourceImageBlock,
  type ResourceCalloutBlock,
  type ResourceFaqItem,
  type ResourceGeoMetadata,
  type ResourcePageType,
  type ResourceTargetPlatform,
} from "./schema";

export {
  auditResource,
  type ResourceWarning,
} from "./validation";

export {
  runPublish,
  runDelete,
  type PublishResult,
  type DeleteResult,
  type PublishOptions,
  type SiteConfig,
} from "./publish";

export {
  safeJsonLd,
  deriveArticle,
  deriveBreadcrumb,
  deriveFaqPage,
  deriveImageObjects,
  deriveAllJsonLd,
  type ResourceJsonLdBundle,
} from "./jsonld";

export type {
  ContentStore,
  StoredResource,
  ListOptions,
} from "./store";
