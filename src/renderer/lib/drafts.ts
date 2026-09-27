import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './api';

/**
 * Unsaved form state that survives an auto-lock, a sign-out and a closed
 * window.
 *
 * The application locks itself on idle so a walk-away reception desk does not
 * leave patient records open. Without this, a receptionist typing a patient's
 * address would come back to a blank form, and would have to ask the patient
 * to repeat it. Drafts are stored per user in the database, so they survive
 * the lock, and they are never visible to anyone else.
 */

const SAVE_DELAY_MS = 800;

export interface Draft<T> {
  /** The value to render. Starts as `initial`, then becomes the saved draft. */
  value: T;
  /** True once a saved draft has been adopted, so the form can say so. */
  restored: boolean;
  /** When the draft was last written, for the "unsaved work" notice. */
  savedAt: string | null;
  /** Call from the form whenever its state changes. */
  update: (next: T) => void;
  /** Call when the work has been saved for real and the draft is no longer needed. */
  discard: () => void;
}

export function useDraft<T>(kind: string, initial: T, options: { entityId?: number | null } = {}): Draft<T> {
  const entityId = options.entityId ?? null;
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T>(initial);
  const dirty = useRef(false);
  // The first render must not write an empty form over a real draft.
  const hydrated = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Restore. Runs when the form identity changes, not on every keystroke.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await call<{ payload: T | null; updatedAt: string | null }>('drafts.get', { kind, entityId });
        if (cancelled || !alive.current) return;
        if (result?.payload && typeof result.payload === 'object') {
          latest.current = { ...(initial as object), ...(result.payload as object) } as T;
          setValue(latest.current);
          setSavedAt(result.updatedAt);
          setRestored(true);
        }
      } catch {
        // A draft that cannot be read is not worth failing the form over.
      }
      hydrated.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // `initial` is a fresh object each render, so it is deliberately not a
    // dependency; the form identity is what should re-read a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, entityId]);

  const update = useCallback(
    (next: T) => {
      latest.current = next;
      dirty.current = true;
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      if (!hydrated.current) return;
      timer.current = setTimeout(() => {
        void (async () => {
          try {
            const result = await call<{ savedAt: string }>('drafts.save', {
              kind,
              entityId,
              payload: JSON.stringify(latest.current),
            });
            if (alive.current) setSavedAt(result?.savedAt ?? new Date().toISOString());
          } catch {
            // A draft that cannot be written is a lost convenience, not a lost
            // record — the form itself still works.
          }
        })();
      }, SAVE_DELAY_MS);
    },
    [kind, entityId],
  );

  const discard = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    setSavedAt(null);
    void call('drafts.clear', { kind, entityId }).catch(() => undefined);
  }, [kind, entityId]);

  return { value, restored, savedAt, update, discard };
}
