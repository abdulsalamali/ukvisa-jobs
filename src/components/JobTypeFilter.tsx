import Link from "next/link";
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
}: {
  counts: Record<string, number>;
  selected: string[];
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
                  name="type"
                  value={type}
                  defaultChecked={selected.includes(type)}
                />
                <span>{JOB_TYPE_LABELS[type]}</span>
                <span className="count">{counts[type] ?? 0}</span>
              </label>
            ))}
          </div>
        );
      })}
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Unclassified roles are excluded while a type filter is active.{" "}
        <Link href="/jobs?type=unspecified">Show unclassified</Link>
      </p>
    </fieldset>
  );
}
