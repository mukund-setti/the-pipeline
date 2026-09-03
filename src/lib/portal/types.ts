/**
 * Shared portal data shapes. Author identity is denormalized onto rows
 * (author_name, school) so lists render without profile joins, and so the
 * demo store and the Supabase store return identical shapes.
 */
import type { PortalSchoolSlug } from '../schools';

export type PortalUser = {
  id: string;
  email: string;
  name: string;
  school: PortalSchoolSlug;
  /** True when running the dev-only demo session (?demo=<school>). */
  demo: boolean;
};

export type ChannelScope = 'national' | 'chapter' | 'topic';

export type Channel = {
  slug: string;
  name: string;
  scope: ChannelScope;
  /** Set only for chapter channels. */
  school: PortalSchoolSlug | null;
  description: string;
};

export type ChatMessage = {
  id: string;
  channel: string;
  userId: string;
  authorName: string;
  school: string;
  body: string;
  createdAt: string;
};

export type ForumPost = {
  id: string;
  userId: string;
  authorName: string;
  school: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  replyCount: number;
};

export type ForumReply = {
  id: string;
  postId: string;
  userId: string;
  authorName: string;
  school: string;
  body: string;
  createdAt: string;
};

export type OpportunityKind = 'internship' | 'new-grad' | 'program';

/** A member's stored resume. url is a short-lived signed link (null in demo). */
export type ResumeInfo = {
  name: string;
  updatedAt: string;
  url: string | null;
};

/** Per-member marks on a job: saved (flagged to revisit) and applied. */
export type JobAction = 'saved' | 'applied';
export type JobActionMap = Record<string, Partial<Record<JobAction, boolean>>>;

/**
 * How far a member has gotten on something they applied to. Ordered, because
 * the tracker sorts and renders stage chips in this sequence.
 *
 * Note the deliberate overlap with JobAction 'applied': a job_actions row with
 * action='applied' is what puts a role in the tracker at all. This type only
 * records how far it has since progressed, and a role with no stage row yet
 * reads as 'applied'. Keeping one source of truth for "am I tracking this"
 * means the two can never drift, and every mark made before the tracker
 * existed shows up in it without a migration.
 */
export const APPLICATION_STAGES = ['applied', 'interview', 'offer', 'rejected'] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** A member's progress on one role they applied to. */
export type JobApplication = {
  stage: ApplicationStage;
  /** Free-text member note: recruiter name, next step, whatever helps. */
  note: string;
  /** When the stage last moved; the tracker sorts on this. */
  updatedAt: string;
};

export type JobApplicationMap = Record<string, JobApplication>;

export type Opportunity = {
  id: string;
  title: string;
  company: string;
  url: string;
  kind: OpportunityKind;
  /** Where the tracker found it, e.g. "Simplify · GitHub" or "Hacker News". */
  source: string;
  tags: string[];
  location: string | null;
  deadline: string | null;
  postedAt: string;
};

/**
 * Channel roster for a chapter's sidebar and for seeding. Slugs must match
 * the rows seeded by supabase/schema.sql.
 */
export function channelsForSchool(school: PortalSchoolSlug): Channel[] {
  return [
    {
      slug: 'national',
      name: 'national',
      scope: 'national',
      school: null,
      description: 'Every chapter, one room. Wins, questions, and hellos.',
    },
    {
      slug: `chapter-${school}`,
      name: `${school}-chapter`,
      scope: 'chapter',
      school,
      description: 'Your campus chapter. Meetups, campus events, local drops.',
    },
    {
      slug: 'interview-prep',
      name: 'interview-prep',
      scope: 'topic',
      school: null,
      description: 'Mock interviews, DSA grind, behavioral prep.',
    },
    {
      slug: 'job-postings',
      name: 'job-postings',
      scope: 'topic',
      school: null,
      description: 'Member-shared roles and referrals. The gatekept stuff.',
    },
    {
      slug: 'resume-review',
      name: 'resume-review',
      scope: 'topic',
      school: null,
      description: 'Drop your resume, get line-by-line edits from fellows.',
    },
    {
      slug: 'wins',
      name: 'wins',
      scope: 'topic',
      school: null,
      description: 'Offers, interviews, breakthroughs. Post it, we celebrate.',
    },
  ];
}
