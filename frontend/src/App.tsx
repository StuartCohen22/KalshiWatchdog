import { NavLink, Route, Routes } from "react-router-dom";

import { Analytics } from "./views/Analytics";
import { AnomalyDetail } from "./views/AnomalyDetail";
import { Dashboard } from "./views/Dashboard";
import { KnownCases } from "./views/KnownCases";
import { Markets } from "./views/Markets";
import { MarketSearch } from "./views/MarketSearch";

export default function App() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="page-shell">
        <header className="mb-8 flex flex-col gap-4 border-b border-border-default pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">ECU ACM Spark / AWS Track</p>
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-mono text-2xl font-semibold uppercase tracking-[0.18em] text-text-primary">
                Kalshi Watchdog
              </span>
              <span className="rounded-full border border-border-default px-3 py-1 text-xs uppercase tracking-[0.18em] text-text-secondary">
                Claude 3 Haiku · Kalshi Intel
              </span>
            </div>
          </div>

          <nav className="flex flex-wrap gap-2">
            {[
              { to: "/", label: "Dashboard" },
              { to: "/markets", label: "Markets" },
              { to: "/analytics", label: "Analytics" },
              { to: "/search", label: "Market search" },
              { to: "/known-cases", label: "Known cases" },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `rounded-full border px-4 py-2 text-sm font-medium transition ${
                    isActive
                      ? "border-border-accent bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "border-border-default text-text-secondary hover:border-border-accent hover:text-text-primary"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/anomalies/:anomalyId" element={<AnomalyDetail />} />
          <Route path="/search" element={<MarketSearch />} />
          <Route path="/known-cases" element={<KnownCases />} />
        </Routes>
      </div>
    </div>
  );
}
