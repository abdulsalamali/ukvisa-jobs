"use client";

import { JOB_TYPE_LABELS } from "@/lib/classify";
import type { JobType } from "@/lib/types";

const GROUPS: { label: string; types: JobType[] }[] = [
  {
    label: "Student & Graduate Jobs",
    types: ["graduate", "internship", "placement", "insight"],
  },
  {
    label: "Experienced Hire Jobs",
    types: ["entry_level", "associate", "mid_senior", "director"],
  },
];

export function JobTypeFilter({
  counts,
  selected,
  onToggle,
}: {
  counts: Record<string, number>;
  selected: string[];
  onToggle: (type: string) => void;
}) {
  return (
    <fieldset className="filter-group">
      <legend>Job type</legend>
      {GROUPS.map((group) => {
        const groupTotal = group.types.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
        return (
          <div key={group.label}>
            <div className="group-label">
              <span>{group.label}</span>
              <span className="count">{groupTotal}</span>
            </div>
            {group.types.map((type) => (
              <label key={type} className="sub">
                <input
                  type="checkbox"
                  checked={selected.includes(type)}
                  onChange={() => onToggle(type)}
                />
                <span>{JOB_TYPE_LABELS[type]}</span>
                <span className="count">{counts[type] ?? 0}</span>
              </label>
            ))}
          </div>
        );
      })}
      <label className="sub">
        <input
          type="checkbox"
          checked={selected.includes("unspecified")}
          onChange={() => onToggle("unspecified")}
        />
        <span>Unclassified</span>
        <span className="count">{counts.unspecified ?? 0}</span>
      </label>
    </fieldset>
  );
}
