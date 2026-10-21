import { useEffect, useRef } from 'react';
import type { JobSummary } from '../types';

/**
 * Subscribe to a job's server-sent events. Falls back to polling if the
 * EventSource connection cannot be established.
 */
export function useJobEvents(
  jobId: string | undefined,
  onUpdate: (summary: JobSummary) => void,
): void {
  const handler = useRef(onUpdate);
  handler.current = onUpdate;

  useEffect(() => {
    if (!jobId) return;

    let source: EventSource | undefined;
    let pollTimer: number | undefined;
    let closed = false;

    const startPolling = () => {
      if (pollTimer !== undefined || closed) return;
      pollTimer = window.setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);
          if (res.ok) handler.current((await res.json()) as JobSummary);
        } catch {
          /* transient network error; keep polling */
        }
      }, 2000);
    };

    try {
      source = new EventSource(`/api/jobs/${jobId}/events`);
      source.onmessage = (event) => {
        try {
          handler.current(JSON.parse(event.data) as JobSummary);
        } catch {
          /* malformed frame; ignore */
        }
      };
      source.onerror = () => {
        // EventSource retries automatically; add polling as a safety net.
        startPolling();
      };
      source.onopen = () => {
        if (pollTimer !== undefined) {
          clearInterval(pollTimer);
          pollTimer = undefined;
        }
      };
    } catch {
      startPolling();
    }

    return () => {
      closed = true;
      source?.close();
      if (pollTimer !== undefined) clearInterval(pollTimer);
    };
  }, [jobId]);
}
