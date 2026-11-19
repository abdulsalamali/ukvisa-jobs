"use client";

const OPTIONS = [
  { value: "relevance", label: "Best match" },
  { value: "newest", label: "Newest" },
  { value: "salary", label: "Salary" },
];

/** Submits the surrounding filter form whenever the sort changes. */
export function SortSelect({ value }: { value: string }) {
  return (
    <select
      name="sort"
      defaultValue={value}
      className="select"
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      aria-label="Sort jobs"
    >
      {OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
