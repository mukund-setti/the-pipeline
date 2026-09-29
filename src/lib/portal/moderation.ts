/**
 * Content guardrails for chat messages, forum posts and replies.
 *
 * This is the instant, in-browser check so a member sees why something
 * will not post before it goes anywhere. The database runs the same rules
 * (supabase/guardrails.sql, portal_moderation_reason) on every insert, so a
 * script talking to Supabase directly is blocked too. Keep the term lists
 * here and the moderation_terms seed in guardrails.sql in sync.
 *
 * Matching runs on a normalized copy of the text: lowercased, accents
 * stripped, common letter swaps undone (sh1t, @ss, $), punctuation turned
 * into spaces, and spaced-out letters joined back up ("f u c k"). Each term
 * tolerates stretched letters ("fuuuck"). Three match modes:
 *
 *   word  whole word, plus a plural s/es ("nude" matches "nudes", not "nuder")
 *   stem  word start, any ending ("slut" matches "slutty")
 *   any   anywhere, even inside other words; only for terms that never
 *         appear inside ordinary words
 */

export type ModerationCategory = 'hate' | 'sexual' | 'threat' | 'profanity' | 'personal' | 'spam';
type Mode = 'word' | 'stem' | 'any';
type Term = { term: string; category: ModerationCategory; mode: Mode };

/** An error whose message is written for the member and safe to show as is. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

const MESSAGES: Record<ModerationCategory, string> = {
  hate: 'That includes a slur or hateful language. The Pipeline is for everyone, so it cannot be posted.',
  sexual: 'That includes sexual content, which is not allowed in the portal.',
  threat: 'That reads as a threat or tells someone to hurt themselves. It cannot be posted.',
  profanity: 'Keep it professional: that includes profanity. Reword it and try again.',
  personal:
    'That looks like a Social Security or card number. Never post those, even in a chapter channel.',
  spam: 'That has a lot of links. Keep it to a few so it does not read as spam.',
};

// Terms are lowercase letters and spaces only. A space inside a phrase also
// matches no space ("kill yourself" catches "killyourself").
const TERMS: Term[] = [
  ...terms('hate', 'any', ['nigger', 'nigga', 'faggot', 'wetback', 'towelhead', 'raghead']),
  ...terms('hate', 'word', ['fag', 'retard', 'retarded', 'tranny', 'kike', 'spic', 'gook', 'beaner', 'paki']),
  ...terms('sexual', 'any', ['blowjob', 'handjob', 'onlyfans', 'send nudes']),
  ...terms('sexual', 'stem', ['porn', 'dildo', 'hentai']),
  ...terms('sexual', 'word', ['nude', 'horny', 'nsfw', 'titties']),
  ...terms('threat', 'word', [
    'kys',
    'kill yourself',
    'kill urself',
    'kill ur self',
    'neck yourself',
    'hang yourself',
    'go die',
    'hope you die',
    'i will kill you',
    'ill kill you',
    'gonna kill you',
    'going to kill you',
  ]),
  ...terms('profanity', 'any', ['fuck', 'motherfucker', 'asshole']),
  ...terms('profanity', 'stem', ['bitch', 'cunt', 'whore', 'slut']),
  // Not stems: "shit" would catch "shiitake", "dick" the name Dick.
  ...terms('profanity', 'word', ['shit', 'shitty', 'bullshit', 'shithead', 'cock', 'pussy', 'bastard', 'wtf', 'stfu']),
];

/** Most links a single message, post or reply may carry. */
export const MAX_LINKS = 5;

function terms(category: ModerationCategory, mode: Mode, list: string[]): Term[] {
  return list.map((term) => ({ term, category, mode }));
}

// 0->o 1->i 3->e 4->a 5->s 7->t 8->b @->a $->s !->i |->i +->t
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't',
};

export function normalizeForModeration(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Only swaps that lead into a letter ("sh!t", "a$$hole"), so "wow!" and
    // "$50" stay as they are.
    .replace(/[0134578@$!|+](?=[0134578@$!|+]*[a-z])/g, (c) => LEET[c])
    .replace(/[^a-z]+/g, ' ')
    .trim()
    // Join letters spaced out one at a time: "f u c k" -> "fuck".
    .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1');
}

function termPattern({ term, mode }: Term): RegExp {
  // Each letter may repeat ("fuuuck"); a space in a phrase is optional.
  const core = term.replace(/[a-z]/g, '$&+').replace(/ /g, '\\s*');
  const src = mode === 'word' ? `\\b${core}(e?s)?\\b` : mode === 'stem' ? `\\b${core}` : core;
  return new RegExp(src);
}

const PATTERNS = TERMS.map((t) => ({ category: t.category, re: termPattern(t) }));

// SSN (123-45-6789) or a card-length run of digits (13 to 19, spaces or
// dashes allowed between them).
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/;

/**
 * Returns the reason `text` cannot be posted, written for the member, or
 * null when it is fine. Pass every user-written field (title, body, tags).
 */
export function moderationReason(...fields: string[]): string | null {
  const raw = fields.join('\n');
  if (SSN.test(raw) || CARD.test(raw)) return MESSAGES.personal;
  if ((raw.match(/https?:\/\//gi) ?? []).length > MAX_LINKS) return MESSAGES.spam;
  const norm = normalizeForModeration(raw);
  for (const { category, re } of PATTERNS) {
    if (re.test(norm)) return MESSAGES[category];
  }
  return null;
}

/** Throws a UserFacingError when any field fails moderationReason. */
export function assertPostable(...fields: string[]): void {
  const reason = moderationReason(...fields);
  if (reason) throw new UserFacingError(reason);
}
