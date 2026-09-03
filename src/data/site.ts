/**
 * The Pipeline: single source of truth for copy + data.
 * Every page pulls from here, so edits land everywhere at once.
 *
 * Two TODOs the build must surface to the founder before publishing:
 *   1. Fill in the real `links` (Discord invite, interest form, contact).
 *   2. VERIFY every entry in `placements` is accurate and approved.
 */

export const site = {
  name: 'The Pipeline',
  /** Used as the homepage <title> suffix and brand wordmark. */
  title: 'The Pipeline',
  location: 'University of California',
  established: '2026',
  themeColor: '#0F1912', // keep in sync with canopy.DEFAULT in tailwind.config.ts (a <meta> needs a literal)
  /** Default meta description (homepage + OG fallback). */
  description:
    'A fellow-run community across the UC system moving underrepresented undergrads in tech into the rooms they were kept out of, through gatekept job drops, resume reviews, and mock interviews run by people who have already landed.',
  ogDescription:
    'The talent was never the problem. We hand gatekept access to the people who have been locked out of it.',
} as const;

/** Primary nav. The Join CTA is rendered separately as a button. */
export const nav = [
  { label: 'How it works', href: '/how/' },
  { label: 'Outcomes', href: '/outcomes/' },
  { label: 'About', href: '/about/' },
  { label: 'Portal', href: '/portal/' },
] as const;

export const navCta = { label: 'Join', href: '/join/' } as const;

/** Home hero strings. Undergrad identity up top, a success proof point below. */
export const hero = {
  eyebrow: 'UC system · Undergrad fellowship · Est. 2026',
  proof: '65% of fellows land an internship',
} as const;

/**
 * External destinations.
 * NOTE: the Discord invite is intentionally NOT here. It is gated behind
 * university verification and served only from the server (DISCORD_INVITE_URL
 * env var) via /api/discord-invite, so it never ships to the client. All
 * "Join the Discord" buttons point to /join, which runs the verification gate.
 */
export const links = {
  form: 'https://forms.gle/REPLACE-WITH-FORM', // TODO: real interest form
  contact: 'mailto:REPLACE@pipelineco.org', // TODO: real contact (email or LinkedIn)
} as const;

export type Placement = {
  org: string;
  role: string;
  /** Short brand monogram used as the faint card backdrop. */
  mark?: string;
  /** Optional: drop an official logo at public/img/logos/<file> and set the
   *  path here to use it as the backdrop instead of the monogram. */
  logo?: string;
};

/**
 * Where fellows have landed. Used in the home drop-feed marquee and the
 * outcomes board. TODO: VERIFY each of these with the founder before
 * publishing. Do not invent placements.
 */
export const placements: Placement[] = [
  { org: 'Capital One', role: 'Internship', mark: 'C1', logo: '/img/logos/capital-one.webp' },
  { org: 'MLT', role: 'Career Prep', mark: 'MLT', logo: '/img/logos/mlt.webp' },
  { org: 'Break Through Tech', role: '@ Cornell', mark: 'BTT', logo: '/img/logos/break-through-tech.webp' },
  { org: 'American Express', role: 'Internship', mark: 'AX', logo: '/img/logos/american-express.webp' },
  { org: 'Amazon', role: 'Full-Time Offer', mark: 'a', logo: '/img/logos/amazon.webp' },
];

export type Stat = { num: string; cap: string; win?: boolean };

export const stats: Stat[] = [
  { num: '50+', cap: 'Undergrad fellows' },
  { num: '5+', cap: 'Universities' },
  { num: '65%', cap: 'Landed an internship', win: true },
  { num: '$0', cap: 'To join' },
  { num: '100%', cap: 'Fellow-led' },
];

export type Stage = {
  num: string;
  label: string;
  title: string;
  /** Long form, used on the How It Works page. */
  body: string;
  /** Short form, used in the home teaser. */
  short: string;
};

export const stages: Stage[] = [
  {
    num: '01',
    label: 'Get in',
    title: 'Access the drops',
    body: 'The moment you are in the Discord, you see the job and internship postings most people never do: the early ones, the referral-only ones, the ones that quietly get gatekept. Fresh roles land in the feed every week.',
    short:
      'Join the Discord and the gatekept job and internship postings start showing up, the ones most people never see.',
  },
  {
    num: '02',
    label: 'Get sharp',
    title: 'Build the leverage',
    body: 'A posting is not an offer. Fellows review your resume line by line, run mock interviews until the nerves are gone, and walk you through what each company process actually looks like, because they have been through it.',
    short:
      'Resume reviews, mock interviews, and strategy sessions with fellows who have already sat on the other side of the table.',
  },
  {
    num: '03',
    label: 'Get the offer',
    title: 'Walk in ready',
    body: 'You apply with a community in your corner instead of a cold portal and a prayer. Fellows have reached Capital One final rounds, MLT Career Prep, and more, and the deal is simple: once you land, you pull the next person up.',
    short: 'Apply with a community in your corner, then pull the next person up behind you.',
  },
];

export type Feature = { icon: string; title: string; body: string };

/** "What every fellow gets": the membership grid. */
export const features: Feature[] = [
  {
    icon: 'feed',
    title: 'Gatekept job drops',
    body: 'A live feed of internships and new-grad roles sourced through our network, including the ones that never hit a public board.',
  },
  {
    icon: 'resume',
    title: 'Resume reviews',
    body: 'Honest, specific edits from fellows who have gotten resumes past real recruiters, not generic templated advice.',
  },
  {
    icon: 'mock',
    title: 'Mock interviews',
    body: 'Behavioral and technical reps until you can walk into the room calm, with feedback after every run.',
  },
  {
    icon: 'clock',
    title: 'Weekly office hours',
    body: 'Drop in over Discord and Google Meet to ask anything: applications, negotiation, "is this offer good," whatever is in front of you.',
  },
  {
    icon: 'strategy',
    title: 'Career strategy',
    body: 'A real plan for the season (which companies, which timelines, what to prioritize) instead of applying into the void.',
  },
  {
    icon: 'people',
    title: 'People who pull you up',
    body: 'The whole thing only works because fellows who make it reach back. You are joining a community, not a mailing list.',
  },
];

export type FaqItem = { q: string; a: string };

export const faq: FaqItem[] = [
  {
    q: 'Who is this for?',
    a: 'Undergrads who are underrepresented in tech: first-gen students and anyone who has been on the outside of these opportunities, looking for internships, coaching, and a community that has their back.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing. The Pipeline is free, and that is not changing. Removing barriers is the entire point.',
  },
  {
    q: 'Which schools can join?',
    a: 'The Pipeline runs across the University of California system. If you have a UC email, you can verify and get in. We started at UC Irvine and have grown to fellows across UC campuses.',
  },
  {
    q: 'How much time does it take?',
    a: 'As much or as little as you need. Use the job drops when you are searching, drop into office hours when you have a question, and show up for mocks when you have an interview coming. It flexes around your schedule.',
  },
];

/** The three-paragraph About story. HTML is trusted (authored here). */
export const aboutStory: string[] = [
  'The talent has always been here. Brilliant, qualified, hungry people: first-gen students, people without the right connections, people who were never handed the map. What is missing is not ability. It is <b>access</b>: the referral that gets your resume read, the posting that goes out before it is public, the person who will tell you what the interview is actually like.',
  'That access has always existed. It just circulated quietly, among people who already had it. The Pipeline takes it and hands it to the people who have been locked out, then gives them the coaching and the community to use it well.',
  'We started as a Discord at UC Irvine where one person shared the gatekept postings they had fought to find. It grew into a community of <b>50+ fellows across UC campuses</b> reviewing each other\'s resumes, running each other\'s mock interviews, and landing real offers. The name is the thesis: they called us the pipeline problem. <b>We decided to be the pipeline.</b>',
];

/** "What makes us different" checklist. HTML strings (bold allowed). */
export const differences: string[] = [
  '<b>Access, handed over.</b> We do not talk about the hidden job market. We drop it in your feed every week.',
  '<b>Run by fellows, not staff.</b> The people coaching you are the people who just did it. No consultants, no script.',
  '<b>Outcomes, not vibes.</b> We measure ourselves by offers landed and interviews reached, not events held.',
  '<b>Free, and staying that way.</b> The whole point is removing barriers. Adding a paywall would defeat it.',
];

export type JoinStep = { n: number; title: string; body: string };

export const joinSteps: JoinStep[] = [
  {
    n: 1,
    title: 'Join the Discord',
    body: 'This is home base. The job drops, office hours, and the whole community live here. You will feel the difference the moment you are in.',
  },
  {
    n: 2,
    title: 'Fill the interest form',
    body: 'Tell us a bit about you and what you are aiming for, so fellows can point you at the right roles and the right people fast.',
  },
  {
    n: 3,
    title: 'Show up to office hours',
    body: 'Drop in, introduce yourself, bring a question. That is it. You are a fellow.',
  },
];

/** "Once you're in, here's what changes." HTML strings (bold allowed). */
export const expectations: string[] = [
  'The <b>gatekept job and internship drops</b> start showing up in your feed every week.',
  'You can drop your <b>resume</b> for honest, specific edits from fellows who have gotten past recruiters.',
  'You can book <b>mock interviews</b> and run them until the nerves are gone.',
  'You get a <b>strategy</b> for the season instead of applying into the void.',
  'And when you land, <b>you reach back</b> and pull the next person up.',
];

/** Mission / voice strings to reuse verbatim. Do not add buzzwords. */
export const voice = {
  thesis: 'The talent was never the problem.',
  thesisTail: 'They called us the pipeline problem. We decided to be the pipeline.',
  /** Brand tagline; "Together." is appended in gold where it renders.
   *  Reuses the three-stage triad the rest of the site already speaks in
   *  (see `stages` and the How It Works section head) so the footer lands on
   *  our own language instead of generic gerunds. */
  tagline: 'Get in. Get sharp. Get the offer.',
} as const;

export const footer = {
  builtBy: 'Built and run by fellows · Across the UC system',
  copyright: '© 2026 The Pipeline',
} as const;
