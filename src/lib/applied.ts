"use client";

import { useEffect, useState } from "react";

/**
 * Which jobs you have marked as applied. Stored in this browser only —
 * nothing is sent anywhere, and no account is needed.
 */

const STORAGE_KEY = "sponsorboard.applied.v1";
export const APPLIED_EVENT = "sponsorboard:applied";

export function loadApplied(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function setApplied(jobId: string, applied: boolean): void {
  const current = new Set(loadApplied());
  if (applied) current.add(jobId);
  else current.delete(jobId);

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...current]));
  // Other components and tabs listen for this to stay in sync.
  window.dispatchEvent(new Event(APPLIED_EVENT));
}

export function useApplied(): {
  applied: Set<string>;
  count: number;
  toggle: (jobId: string, applied: boolean) => void;
} {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setIds(loadApplied());
    sync();
    window.addEventListener(APPLIED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(APPLIED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return {
    applied: new Set(ids),
    count: ids.length,
    toggle: setApplied,
  };
}
