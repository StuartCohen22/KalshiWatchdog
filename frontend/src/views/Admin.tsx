import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function adminGet<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

interface AdminStats {
  total_users: number;
  requests_24h: number;
  active_users: number;
}

interface AdminUser {
  user_id: string;
  email: string;
  created: string;
  status: string;
}

interface UsageRecord {
  user_id: string;
  timestamp: string;
  path: string;
  method: string;
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border-default bg-bg-secondary p-5">
      <p className="text-xs uppercase tracking-widest text-text-tertiary">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold text-text-primary">{value}</p>
    </div>
  );
}

export function Admin() {
  const { idToken, isAdmin } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      adminGet<AdminStats>("/api/admin/stats", idToken),
      adminGet<AdminUser[]>("/api/admin/users", idToken),
      adminGet<UsageRecord[]>("/api/admin/usage", idToken),
    ])
      .then(([s, u, r]) => {
        setStats(s);
        setUsers(u);
        setUsage(r);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [idToken, isAdmin]);

  if (!isAdmin) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-text-secondary">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">System</p>
        <h1 className="mt-1 font-mono text-3xl font-semibold uppercase tracking-[-0.02em] text-text-primary">
          Admin Dashboard
        </h1>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Stats */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total users" value={stats.total_users} />
          <StatCard label="Requests (24h)" value={stats.requests_24h} />
          <StatCard label="Active users (24h)" value={stats.active_users} />
        </div>
      )}

      {/* Users table */}
      <section className="panel">
        <p className="eyebrow">Registered users</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-xs uppercase tracking-widest text-text-tertiary">
                <th className="pb-3 pr-6">Email</th>
                <th className="pb-3 pr-6">User ID</th>
                <th className="pb-3 pr-6">Status</th>
                <th className="pb-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {users.map((u) => (
                <tr key={u.user_id} className="text-text-secondary">
                  <td className="py-3 pr-6 font-medium text-text-primary">{u.email}</td>
                  <td className="py-3 pr-6 font-mono text-xs text-text-tertiary">{u.user_id.slice(0, 8)}…</td>
                  <td className="py-3 pr-6">
                    <span className="rounded-full border border-border-default px-2 py-0.5 text-[10px] uppercase tracking-wider">
                      {u.status}
                    </span>
                  </td>
                  <td className="py-3 text-xs text-text-tertiary">{u.created ? new Date(u.created).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-text-tertiary">No users found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent requests */}
      <section className="panel">
        <p className="eyebrow">Recent API requests</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-xs uppercase tracking-widest text-text-tertiary">
                <th className="pb-3 pr-6">User</th>
                <th className="pb-3 pr-6">Method</th>
                <th className="pb-3 pr-6">Path</th>
                <th className="pb-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {usage.slice(0, 50).map((r, i) => (
                <tr key={i} className="text-text-secondary">
                  <td className="py-2 pr-6 font-mono text-xs text-text-tertiary">{r.user_id.slice(0, 8)}…</td>
                  <td className="py-2 pr-6 text-xs uppercase">{r.method}</td>
                  <td className="py-2 pr-6 font-mono text-xs">{r.path}</td>
                  <td className="py-2 text-xs text-text-tertiary">{new Date(r.timestamp).toLocaleTimeString()}</td>
                </tr>
              ))}
              {usage.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-text-tertiary">No usage data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
