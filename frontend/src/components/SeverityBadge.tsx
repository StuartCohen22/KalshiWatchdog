import type { Severity } from "../types";

const BADGE: Record<Severity, { label: string; cls: string; dot: string }> = {
  CRITICAL: {
    label: "Critical",
    cls: "bg-[#ff2a6d]/10 text-[#ff2a6d] ring-[#ff2a6d]/20",
    dot: "bg-[#ff2a6d] animate-pulse",
  },
  HIGH: {
    label: "High",
    cls: "bg-[#ff9e64]/10 text-[#ff9e64] ring-[#ff9e64]/20",
    dot: "bg-[#ff9e64]",
  },
  MEDIUM: {
    label: "Medium",
    cls: "bg-[#f59e0b]/10 text-[#f59e0b] ring-[#f59e0b]/20",
    dot: "bg-[#f59e0b]",
  },
  LOW: {
    label: "Low",
    cls: "bg-[#4a5568]/10 text-[#9e9e9e] ring-[#4a5568]/20",
    dot: "bg-[#4a5568]",
  },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const cfg = BADGE[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold ring-1 ring-inset ${cfg.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
