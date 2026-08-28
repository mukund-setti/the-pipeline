/**
 * Resume drop island for the portal home page. One card, four states: a slim
 * loading skeleton, the "Get apply-ready" drop zone, an upload-in-flight
 * spinner, and the compact on-file row with View/Replace/Remove. Files live
 * in the portal store (Supabase private bucket when live, metadata only in
 * demo); extension and size are checked here first so most mistakes never
 * leave the browser, and the store re-validates as the backstop.
 */
import { useEffect, useRef, useState } from 'react';
import type { ResumeInfo } from '../../lib/portal/types';
import type { PortalStore } from '../../lib/portal/data';
import { waitForPortalUser, initPortalData } from '../../lib/portal/data';

const MAX_BYTES = 5 * 1024 * 1024;
const OK_EXTENSIONS = ['pdf', 'doc', 'docx'];

/** Tiny relative-time formatter: "just now", "12m", "3h", "2d". */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!iso || Number.isNaN(diff)) return 'recently';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function validate(file: File): string | null {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!OK_EXTENSIONS.includes(ext)) return 'Use a PDF or Word file (.pdf, .doc, .docx).';
  if (file.size > MAX_BYTES) return 'That file is over 5 MB. Trim it down and try again.';
  return null;
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

export default function ResumeCard({ school }: { school: string }) {
  const [store, setStore] = useState<PortalStore | null>(null);
  const [resume, setResume] = useState<ResumeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await waitForPortalUser();
      const portal = await initPortalData(user);
      if (cancelled) return;
      if (portal.notice === 'setup-required') {
        window.dispatchEvent(new CustomEvent('portal:notice'));
      }
      setStore(portal.store);
      const existing = await portal.store.getResume();
      if (cancelled) return;
      setResume(existing);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [school]);

  async function handleFile(file: File | null | undefined) {
    if (!file || !store || uploadingName) return;
    const problem = validate(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setUploadingName(file.name);
    try {
      const info = await store.uploadResume(file);
      setResume(info);
      setConfirmRemove(false);
    } catch (err) {
      setError((err as { message?: string })?.message || 'Upload did not go through. Try again.');
    } finally {
      setUploadingName(null);
    }
  }

  async function handleRemove() {
    if (!store) return;
    setError(null);
    try {
      await store.removeResume();
      setResume(null);
    } catch (err) {
      setError((err as { message?: string })?.message || 'Could not remove it. Try again.');
    } finally {
      setConfirmRemove(false);
    }
  }

  const demoNote =
    store && !store.live ? (
      <p className="mt-2 text-[0.75rem] text-ink-soft/80">
        (demo session: the file itself is not stored)
      </p>
    ) : null;

  let body;
  if (loading) {
    // Slim skeleton while the guard and store resolve.
    body = (
      <div className="portal-card animate-pulse p-4" aria-hidden="true">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 flex-none rounded-field bg-line" />
          <div className="min-w-0 flex-1">
            <div className="mb-2 h-3.5 w-1/3 rounded bg-line" />
            <div className="h-3 w-1/4 rounded bg-line/70" />
          </div>
        </div>
      </div>
    );
  } else if (uploadingName) {
    body = (
      <div className="portal-card flex items-center gap-3 p-5" role="status">
        <span
          className="h-5 w-5 flex-none animate-spin rounded-full border-2 border-line"
          style={{ borderTopColor: 'var(--school-deep)' }}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate text-[0.92rem] font-medium text-ink">
          Uploading {uploadingName}
        </span>
      </div>
    );
  } else if (resume) {
    // On file: compact row with the corner "Apply-ready" badge.
    body = (
      <div className="portal-card relative p-5">
        <span className="portal-chip portal-chip--gold absolute -top-2.5 right-5">Apply-ready</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span
            className="flex h-10 w-10 flex-none items-center justify-center rounded-field text-white"
            style={{ background: 'linear-gradient(145deg, var(--school-accent), var(--school-deep))' }}
            aria-hidden="true"
          >
            <DocIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-ink">{resume.name}</p>
            <p className="text-[0.8rem] text-ink-soft">Updated {relativeTime(resume.updatedAt)}</p>
          </div>
          {confirmRemove ? (
            <div className="flex flex-wrap items-center gap-3 text-[0.85rem]">
              <span className="font-medium text-ink">Remove your resume?</span>
              <button
                type="button"
                onClick={handleRemove}
                className="font-semibold text-gold-deep underline-offset-4 hover:underline"
              >
                Yes, remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {resume.url && (
                <a
                  className="portal-btn-ghost"
                  href={resume.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View
                </a>
              )}
              <button
                type="button"
                className="portal-btn-ghost"
                onClick={() => fileInput.current?.click()}
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setConfirmRemove(true);
                }}
                className="px-1.5 text-[0.85rem] font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline"
              >
                Remove
              </button>
            </div>
          )}
        </div>
        {error && <p className="mt-2.5 text-[0.82rem] font-medium text-gold-deep">{error}</p>}
        {demoNote}
      </div>
    );
  } else {
    // No resume yet: the sign-up pitch plus the drop zone.
    body = (
      <div className="portal-card p-6 md:p-7">
        <h3 className="font-display text-h3-lg font-semibold text-ink">Get apply-ready</h3>
        <p className="mt-1.5 max-w-[62ch] text-[0.9rem] leading-relaxed text-ink-soft">
          Drop your resume once and it is on hand every time you hit Apply, and fellows can
          review it when you ask in #resume-review.
        </p>
        <div
          className="mt-4 flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-line-strong px-6 py-10 text-center transition-colors"
          style={
            dragOver
              ? { background: 'var(--school-soft)', borderColor: 'var(--school-deep)' }
              : undefined
          }
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-field bg-brand-soft text-brand">
            <DocIcon className="h-5 w-5" />
          </span>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <span className="text-[0.92rem] font-medium text-ink">Drop your resume here or</span>
            <button
              type="button"
              className="portal-btn-ghost"
              onClick={() => fileInput.current?.click()}
            >
              Browse files
            </button>
          </div>
        </div>
        <p className="mt-2.5 text-[0.78rem] text-ink-soft">
          PDF or Word, up to 5 MB. Only you can see it.
        </p>
        {error && <p className="mt-2 text-[0.82rem] font-medium text-gold-deep">{error}</p>}
        {demoNote}
      </div>
    );
  }

  return (
    <section className="mt-6" aria-label="Your resume">
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          handleFile(file);
        }}
      />
      {body}
    </section>
  );
}
