/**
 * Posting age rules for the opportunities feed.
 *
 * Rows are insert-only and nothing ever tells us a posting closed, so the
 * feed would otherwise grow without bound and fill with dead links. We know
 * exactly one fact — how long ago we first saw it — so that is all the UI
 * claims. Old rows are called "Older", never "Closed": asserting closed would
 * be a guess rendered as a statement.
 *
 * Deleting is not an option. job_actions.opportunity_id cascades on delete,
 * so removing an old row would silently erase every member's saved and
 * applied marks for it.
 */

/** Past this, a posting drops out of the default feed. */
export const OLDER_AFTER_DAYS = 60;

const DAY_MS = 86_400_000;

/** True when a posting is older than the cutoff. */
export function isOlder(postedAt: string, now: Date = new Date(), days = OLDER_AFTER_DAYS): boolean {
  const t = Date.parse(postedAt);
  // An unparseable date is not evidence of age; leave it in the feed.
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > days * DAY_MS;
}

/**
 * Should this row be hidden behind "Show older"?
 *
 * A role the member saved or applied to is never hidden, however old. Hiding
 * someone's own shortlist from them would be worse than the stale links this
 * rule exists to prevent.
 */
export function isHiddenByAge(
  postedAt: string,
  marks: { saved?: boolean; applied?: boolean } | undefined,
  now: Date = new Date(),
  days = OLDER_AFTER_DAYS
): boolean {
  if (marks?.saved || marks?.applied) return false;
  return isOlder(postedAt, now, days);
}
