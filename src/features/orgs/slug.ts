import { randomBytes } from "crypto";

/**
 * URL-safe slug base from an organization name. Deliberately lossy: anything
 * that is not a-z0-9 becomes a dash (accents included — "Ümlaut" → "mlaut"),
 * which is fine because the slug is a URL handle, not a display name.
 */
export function slugifyBase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base.length >= 2 ? base : "org";
}

/**
 * Slug for a new org: name base + random suffix. The suffix makes collisions
 * between concurrent creations practically impossible; the DB unique
 * constraint remains the backstop and createOrg retries on 23505.
 * Must stay in sync with the organizations.slug CHECK regex:
 * ^[a-z0-9]+(-[a-z0-9]+)*$
 */
export function newSlug(name: string): string {
  return `${slugifyBase(name)}-${randomBytes(4).toString("hex")}`;
}
