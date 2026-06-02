import type { ResourcePublishPayload } from "./schema";

/**
 * Storage abstraction for published resources.
 *
 * `auto-geo`'s publish endpoint and render path interact with storage
 * exclusively through this interface. Concrete adapters live in
 * `adapters/storage/*` and implement these four methods.
 *
 * A `StoredResource` is the validated payload plus a `storedAt` ISO
 * timestamp set by the adapter on each write. Adapters MUST persist the
 * full payload — JSON-LD derivation, metadata, and rendering all read
 * back from the stored shape.
 *
 * Implementations should be idempotent on write (re-publishing the same
 * slug overwrites the existing entry) and must surface errors via
 * thrown exceptions rather than silent no-ops; the publish endpoint
 * relies on rejection to return 502.
 */

export type StoredResource = ResourcePublishPayload & {
  /** ISO timestamp set when the resource was last written. */
  storedAt: string;
};

export type ListOptions = {
  /** Cap on the number of resources returned. Adapter may ignore. */
  limit?: number;
  /** Skip the first N entries. Adapter may ignore. */
  offset?: number;
};

export interface ContentStore {
  /**
   * Write a resource. Idempotent: re-publishing an existing slug
   * overwrites the prior entry. Throws on backend errors so the publish
   * endpoint can return 502.
   */
  publish(payload: ResourcePublishPayload): Promise<void>;

  /**
   * Fetch a resource by slug. Returns null if not found. Should NOT
   * throw on missing entries; only on backend errors. Returning null on
   * a transient error is acceptable for graceful degradation during the
   * render path — log it server-side rather than 500-ing.
   */
  get(slug: string): Promise<StoredResource | null>;

  /**
   * List resources in reverse-chronological order by `publishedAt`.
   * Should return an empty array when the store is empty or
   * unconfigured. Drives the `/resources` index.
   */
  list(opts?: ListOptions): Promise<StoredResource[]>;

  /**
   * Remove a resource by slug. Idempotent: deleting a missing slug
   * should not throw.
   */
  delete(slug: string): Promise<void>;
}
