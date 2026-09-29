/**
 * "Top picks" tiering for the opportunities feed: high-paying, high-clout
 * employers (big tech, top startups, quant and elite finance). Shared by the
 * scanner (which stamps a `top-pick` tag at insert time) and the portal
 * client (which also checks the company name, so rows scanned before this
 * list existed still tier correctly without a migration).
 *
 * Keep entries lowercase and normalized the same way normCompany() does. A
 * company matches when its normalized name equals an entry or starts with
 * the entry plus a space ("amazon web services" matches "amazon").
 */
export const TOP_COMPANIES: readonly string[] = [
  // Big tech
  'google', 'alphabet', 'deepmind', 'meta', 'facebook', 'apple', 'amazon', 'aws',
  'netflix', 'microsoft', 'nvidia', 'linkedin', 'tiktok', 'bytedance', 'salesforce',
  'adobe', 'uber', 'airbnb', 'lyft', 'doordash', 'spotify', 'pinterest', 'snap',
  'reddit', 'dropbox', 'roblox', 'tesla', 'spacex', 'waymo', 'intuit', 'qualcomm',
  'amd', 'snowflake', 'datadog', 'mongodb', 'cloudflare', 'palantir', 'bloomberg',
  'capital one', 'instacart', 'duolingo', 'twilio', 'okta', 'elastic',
  // Top startups and AI labs
  'openai', 'anthropic', 'stripe', 'databricks', 'figma', 'notion', 'ramp', 'plaid',
  'brex', 'coinbase', 'robinhood', 'discord', 'scale ai', 'scaleai', 'perplexity',
  'cursor', 'anysphere', 'linear', 'replit', 'vercel', 'anduril', 'rippling',
  'samsara', 'verkada', 'asana', 'affirm', 'chime', 'nuro', 'rivian', 'sierra',
  'harvey', 'elevenlabs', 'cohere', 'mistral', 'xai', 'character ai', 'modal',
  // Quant and elite finance
  'jane street', 'citadel', 'citadel securities', 'two sigma', 'hudson river trading',
  'hrt', 'jump trading', 'drw', 'imc', 'imc trading', 'optiver', 'susquehanna',
  'akuna', 'five rings', 'de shaw', 'd e shaw', 'tower research',
  'tower research capital', 'virtu', 'virtu financial', 'point72', 'millennium',
  'bridgewater', 'jump', 'radix', 'old mission', 'chicago trading',
  'goldman sachs', 'morgan stanley', 'jpmorgan', 'j p morgan', 'blackrock',
];

const TOP_SET = new Set(TOP_COMPANIES);

/** Lowercase, drop punctuation and corporate suffixes. */
export function normCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|group|holdings|lp)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isTopCompany(name: string): boolean {
  const n = normCompany(name);
  if (!n) return false;
  if (TOP_SET.has(n)) return true;
  // Prefix match on whole words: "amazon web services" -> "amazon".
  const words = n.split(' ');
  for (let i = words.length - 1; i > 0; i--) {
    if (TOP_SET.has(words.slice(0, i).join(' '))) return true;
  }
  return false;
}

/** The tag the scanner stamps on rows it already knows are top picks. */
export const TOP_TAG = 'top-pick';

/** A row is a top pick when the scanner tagged it or the company is listed. */
export function isTopPick(o: { company: string; tags: string[] }): boolean {
  return o.tags.includes(TOP_TAG) || isTopCompany(o.company);
}

/** Pay tags look like "$52/hr" or "$180k". */
export function payTag(tags: string[]): string | null {
  return tags.find((t) => t.startsWith('$')) ?? null;
}
