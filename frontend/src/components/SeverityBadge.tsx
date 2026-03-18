import type { Severity } from "../types";

const styles: Record<Severity, string> = {
  CRITICAL: "bg-[var(--severity-critical-bg)] text-[var(--severity-critical)] border-[var(--severity-critical)]/30",
  HIGH: "bg-[var(--severity-high-bg)] text-[var(--severity-high)] border-[var(--severity-high)]/30",
  MEDIUM: "bg-[var(--severity-medium-bg)] text-[var(--severity-medium)] border-[var(--severity-medium)]/30",
  LOW: "bg-[var(--severity-low-bg)] text-[var(--text-secondary)] border-[var(--border-default)]",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] ${styles[severity]}`}
    >
      {severity}
    </span>
  );
}

