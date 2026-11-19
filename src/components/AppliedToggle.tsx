"use client";

import { useEffect, useState } from "react";
import { APPLIED_EVENT, loadApplied, setApplied } from "@/lib/applied";

/** A single toggle: mark this job as applied, or undo it. */
export function AppliedToggle({ jobId }: { jobId: string }) {
  const [applied, setLocal] = useState(false);

  useEffect(() => {
    const sync = () => setLocal(loadApplied().includes(jobId));
    sync();
    window.addEventListener(APPLIED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(APPLIED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [jobId]);

  return (
    <button
      type="button"
      className={`applied-btn${applied ? " is-applied" : ""}`}
      aria-pressed={applied}
      onClick={() => setApplied(jobId, !applied)}
      title={applied ? "Marked as applied — click to undo" : "Mark this job as applied"}
    >
      {applied ? "✓ Applied" : "Mark applied"}
    </button>
  );
}
