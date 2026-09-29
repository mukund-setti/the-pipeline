/**
 * Resume viewer island. Fetches the member's file through the portal store
 * (their own session, private bucket) and shows it inside this page, so the
 * address bar stays on pipelineco.org and no signed storage link is ever
 * exposed. PDFs render inline; Word files cannot render in a browser, so
 * they get a download button instead.
 */
import { useEffect, useState } from 'react';
import type { ResumeInfo } from '../../lib/portal/types';
import { waitForPortalUser, initPortalData } from '../../lib/portal/data';

type State =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'demo'; resume: ResumeInfo }
  | { kind: 'ready'; resume: ResumeInfo; url: string; isPdf: boolean }
  | { kind: 'error'; message: string };

export default function ResumeViewer({ school }: { school: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const user = await waitForPortalUser();
        const portal = await initPortalData(user);
        if (cancelled) return;
        if (portal.notice === 'setup-required') {
          window.dispatchEvent(new CustomEvent('portal:notice'));
        }
        const resume = await portal.store.getResume();
        if (cancelled) return;
        if (!resume) return setState({ kind: 'none' });
        if (!resume.viewable) return setState({ kind: 'demo', resume });
        const blob = await portal.store.downloadResume();
        if (cancelled) return;
        const isPdf = resume.name.toLowerCase().endsWith('.pdf');
        objectUrl = URL.createObjectURL(
          isPdf ? new Blob([blob], { type: 'application/pdf' }) : blob,
        );
        setState({ kind: 'ready', resume, url: objectUrl, isPdf });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: (err as { message?: string })?.message || 'Could not load your resume.',
        });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [school]);

  const back = (
    <a
      href={`/portal/${school}/`}
      className="text-[0.85rem] font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline"
    >
      ← Back to home
    </a>
  );

  if (state.kind === 'loading') {
    return (
      <div className="portal-card flex items-center gap-3 p-5" role="status">
        <span
          className="h-5 w-5 flex-none animate-spin rounded-full border-2 border-line"
          style={{ borderTopColor: 'var(--school-deep)' }}
          aria-hidden="true"
        />
        <span className="text-[0.92rem] font-medium text-ink">Loading your resume</span>
      </div>
    );
  }

  if (state.kind !== 'ready') {
    const message =
      state.kind === 'none'
        ? 'No resume on file yet. Add one from your portal home.'
        : state.kind === 'demo'
          ? `${state.resume.name} is on record, but demo sessions do not store the file itself.`
          : state.message;
    return (
      <div className="portal-card p-6">
        <p className="text-[0.92rem] text-ink">{message}</p>
        <div className="mt-4">{back}</div>
      </div>
    );
  }

  const { resume, url, isPdf } = state;
  return (
    <section aria-label="Your resume">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-h3-lg font-semibold text-ink">{resume.name}</h1>
          <div className="mt-1">{back}</div>
        </div>
        <a className="portal-btn-ghost" href={url} download={resume.name}>
          Download
        </a>
      </div>
      {isPdf ? (
        <iframe
          src={url}
          title={resume.name}
          className="portal-card block w-full overflow-hidden"
          style={{ height: 'calc(100vh - 12rem)', minHeight: '32rem' }}
        />
      ) : (
        <div className="portal-card p-6">
          <p className="text-[0.92rem] text-ink">
            Word files cannot be previewed in the browser. Use Download to open it.
          </p>
        </div>
      )}
    </section>
  );
}
