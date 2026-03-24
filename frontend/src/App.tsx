import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";

import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { Analytics } from "./views/Analytics";
import { AnomalyDetail } from "./views/AnomalyDetail";
import { Dashboard } from "./views/Dashboard";
import { KnownCases } from "./views/KnownCases";
import { Markets } from "./views/Markets";
import { MarketSearch } from "./views/MarketSearch";
import { Watchlist } from "./views/Watchlist";
import { Admin } from "./views/Admin";

// Auth disabled for demo
const AUTH_ENABLED = false;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (!AUTH_ENABLED) return <>{children}</>;
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function UserMenu() {
  const { user, doSignOut } = useAuth();
  if (!user) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-tertiary">{user.email}</span>
      <button
        type="button"
        onClick={() => doSignOut()}
        className="rounded-full border border-border-default px-3 py-1.5 text-xs text-text-secondary transition hover:border-border-accent hover:text-text-primary"
      >
        Sign out
      </button>
    </div>
  );
}

function AppShell() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const isLoginPage = location.pathname === "/login";

  const navItems = [
    { to: "/", label: "Dashboard" },
    { to: "/markets", label: "Markets" },
    { to: "/analytics", label: "Analytics" },
    { to: "/search", label: "Market search" },
    { to: "/watchlist", label: "Watchlist" },
    { to: "/known-cases", label: "Known cases" },
    ...(isAdmin ? [{ to: "/admin", label: "Admin" }] : []),
  ];

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="page-shell">
        {!isLoginPage && (
          <header className="mb-8 flex flex-col gap-4 border-b border-border-default pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="eyebrow">ECU ACM Spark / AWS Track</p>
              <div className="flex flex-wrap items-center gap-4">
                <img src="/logo.png" alt="Kalshi Watchdog" className="h-8 w-8" />
                <span className="font-mono text-2xl font-semibold uppercase tracking-[0.18em] text-text-primary">
                  Kalshi Watchdog
                </span>
                <span className="rounded-full border border-border-default px-3 py-1 text-xs uppercase tracking-[0.18em] text-text-secondary">
                  Claude 3 Haiku · Kalshi Intel
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-3">
              {AUTH_ENABLED && <UserMenu />}
              <nav className="flex flex-wrap gap-2">
                {navItems.map((item) => (
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
            </div>
          </header>
        )}

        <Routes>
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/markets" element={<ProtectedRoute><Markets /></ProtectedRoute>} />
          <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
          <Route path="/anomalies/:anomalyId" element={<ProtectedRoute><AnomalyDetail /></ProtectedRoute>} />
          <Route path="/search" element={<ProtectedRoute><MarketSearch /></ProtectedRoute>} />
          <Route path="/watchlist" element={<ProtectedRoute><Watchlist /></ProtectedRoute>} />
          <Route path="/known-cases" element={<ProtectedRoute><KnownCases /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
