/**
 * Chapter events for the portal home calendar. Add a meeting here and it
 * shows up on that chapter's portal home; nothing else to touch.
 *
 * Whether an event is upcoming or past is worked out in the browser from
 * today's date (Pacific time), so there is no status field to keep current.
 * Leave anything not decided yet as null: the calendar says "to be
 * announced" instead of printing a placeholder.
 */
import type { PortalSchoolSlug } from '../lib/schools';

export type ChapterEvent = {
  /** Stable id, also the page anchor (#event-<id>). */
  id: string;
  school: PortalSchoolSlug;
  title: string;
  /** YYYY-MM-DD, local (Pacific) date. */
  date: string;
  /** True while the date is still a guess; shows "Date to be confirmed". */
  tentative?: boolean;
  /** Free text, e.g. "6:00 to 7:30 pm". */
  time: string | null;
  /** Room and building, e.g. "SSL 248". */
  location: string | null;
  format?: string;
  description: string;
  speakers: string[];
  /** A short extra line, e.g. an announcement made at the meeting. */
  note?: string;
  rsvpUrl?: string | null;
};

export const EVENTS: ChapterEvent[] = [
  {
    id: 'gm-1',
    school: 'uci',
    title: 'General Meeting #1: Student Speaker Panel',
    date: '2026-11-05',
    time: '5:20 to 6:00 pm',
    location: 'DBH 1420',
    format: 'Speaker panel and Q&A',
    description:
      'Our first GM. Student speakers shared how they landed their internships and what recruiting really looked like, followed by Q&A.',
    speakers: ['Jasmine Tu', 'Sergio Alcazar', 'Yutaro Urata'],
  },
  {
    id: 'gm-2',
    school: 'uci',
    title: 'General Meeting #2: Teach For America Ignite Fellowship',
    date: '2026-11-12',
    time: '5:20 to 6:00 pm',
    location: 'DBH 1420',
    format: 'Recruiter talk and alumni Q&A',
    description:
      'A Teach For America recruiter, TFA alumni and a campus ambassador introduce the Ignite Fellowship: a remote, paid role with a $1,000 stipend, open to all majors.',
    speakers: ['Teach For America recruiter', 'TFA alumni and campus ambassador'],
    note: 'Committee applications are open. We will share details at the meeting.',
    rsvpUrl: null,
  },
];

export function eventsForSchool(school: string): ChapterEvent[] {
  return EVENTS.filter((e) => e.school === school).sort((a, b) => a.date.localeCompare(b.date));
}
