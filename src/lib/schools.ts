/**
 * Portal partner schools. The member portal is live at these three campuses;
 * every other UC campus verifies through /join for the Discord but sees a
 * "your chapter is coming" state at /portal.
 *
 * One entry here = one themed portal at /portal/<slug>/. Colors are each
 * school's official blue + gold, layered over the shared Canopy & Light
 * template as CSS variables (see src/styles/portal.css).
 */
export type PortalSchoolSlug = 'uci' | 'ucla' | 'ucr';

export type PortalSchool = {
  slug: PortalSchoolSlug;
  name: string;
  short: string;
  mascot: string;
  /** Email domains that map to this chapter (subdomains match too). */
  domains: string[];
  colors: {
    /** School blue: identity accents on the dark sidebar. */
    accent: string;
    /** Darker blue that passes AA on the parchment background. */
    deep: string;
    /** Pale tint of the blue for chips/fills on light surfaces. */
    soft: string;
    /** School gold, used sparingly (badge ring, wins). */
    gold: string;
  };
};

export const PORTAL_SCHOOLS: PortalSchool[] = [
  {
    slug: 'uci',
    name: 'UC Irvine',
    short: 'UCI',
    mascot: 'Anteaters',
    domains: ['uci.edu'],
    colors: { accent: '#1B7FBD', deep: '#00558C', soft: '#DAE8F1', gold: '#FFD200' },
  },
  {
    slug: 'ucla',
    name: 'UCLA',
    short: 'UCLA',
    mascot: 'Bruins',
    domains: ['ucla.edu'],
    colors: { accent: '#2774AE', deep: '#155D96', soft: '#DCEAF5', gold: '#FFD100' },
  },
  {
    slug: 'ucr',
    name: 'UC Riverside',
    short: 'UCR',
    mascot: 'Highlanders',
    domains: ['ucr.edu'],
    colors: { accent: '#3B6EDA', deep: '#2145A8', soft: '#DDE4F6', gold: '#FFB81C' },
  },
];

/**
 * People who run The Pipeline and need portal access from a non-campus email.
 * Add founders/officers here: address -> home chapter.
 */
export const FOUNDER_ACCESS: Record<string, PortalSchoolSlug> = {
  'mukund.setti@gmail.com': 'uci',
};

export function schoolBySlug(slug: string): PortalSchool | null {
  return PORTAL_SCHOOLS.find((s) => s.slug === slug) ?? null;
}

/**
 * Resolve an email to its portal school. Founder overrides win; otherwise the
 * email domain (or any subdomain of it, so name@g.ucla.edu passes) decides.
 * Returns null when the email has no portal chapter (yet).
 */
export function schoolForEmail(email: string): PortalSchool | null {
  const normalized = email.trim().toLowerCase();
  const override = FOUNDER_ACCESS[normalized];
  if (override) return schoolBySlug(override);
  const at = normalized.lastIndexOf('@');
  if (at < 0) return null;
  const domain = normalized.slice(at + 1);
  return (
    PORTAL_SCHOOLS.find((s) =>
      s.domains.some((d) => domain === d || domain.endsWith('.' + d))
    ) ?? null
  );
}
