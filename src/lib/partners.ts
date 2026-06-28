/**
 * Partner universities. The Discord is gated to students at these schools.
 * Add a campus here (one line) to open it up. UC system for now.
 *
 * Used both client-side (for instant UX feedback) and server-side (the real
 * enforcement happens in src/pages/api/discord-invite.ts).
 */
export type Partner = { domain: string; name: string };

export const PARTNER_UNIVERSITIES: Partner[] = [
  { domain: 'uci.edu', name: 'UC Irvine' },
  { domain: 'ucla.edu', name: 'UCLA' },
  { domain: 'berkeley.edu', name: 'UC Berkeley' },
  { domain: 'ucsd.edu', name: 'UC San Diego' },
  { domain: 'ucdavis.edu', name: 'UC Davis' },
  { domain: 'ucsb.edu', name: 'UC Santa Barbara' },
  { domain: 'ucsc.edu', name: 'UC Santa Cruz' },
  { domain: 'ucr.edu', name: 'UC Riverside' },
  { domain: 'ucmerced.edu', name: 'UC Merced' },
  { domain: 'ucsf.edu', name: 'UC San Francisco' },
];

export type PartnerMatch = { ok: boolean; domain: string; name: string };

/**
 * True for an exact partner domain or any of its subdomains, so student
 * addresses like name@g.ucla.edu or name@mail.ucsd.edu pass, while a lookalike
 * such as name@notucla.edu does not.
 */
export function partnerForEmail(email: string): PartnerMatch {
  const at = email.lastIndexOf('@');
  const domain = at >= 0 ? email.slice(at + 1).toLowerCase().trim() : '';
  const match = PARTNER_UNIVERSITIES.find(
    (u) => domain === u.domain || domain.endsWith('.' + u.domain)
  );
  return { ok: Boolean(match), domain, name: match?.name ?? '' };
}
