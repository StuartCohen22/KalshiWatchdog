import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

type Mode = "signin" | "signup" | "confirm";

export function LoginPage() {
  const { doSignIn, doSignUp, doConfirmSignUp } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        await doSignIn(email, password);
        navigate("/");
      } else if (mode === "signup") {
        await doSignUp(email, password);
        setMode("confirm");
      } else {
        await doConfirmSignUp(email, code);
        await doSignIn(email, password);
        navigate("/");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-bg-primary via-bg-secondary to-bg-primary px-4">
      <div className="w-full max-w-md">
        {/* Logo and branding */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center gap-3">
            <img src="/logo.png" alt="Kalshi Watchdog" className="h-12 w-12" />
            <span className="font-mono text-2xl font-semibold uppercase tracking-[0.18em] text-text-primary">
              Kalshi Watchdog
            </span>
          </div>
          <p className="text-sm text-text-tertiary">
            Prediction market surveillance powered by Claude 3 Haiku
          </p>
        </div>

        {/* Auth card */}
        <div className="rounded-3xl border border-border-default bg-bg-secondary/80 p-8 shadow-2xl backdrop-blur-sm">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-text-primary">
              {mode === "signin" && "Welcome back"}
              {mode === "signup" && "Create your account"}
              {mode === "confirm" && "Verify your email"}
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              {mode === "signin" && "Sign in to access the dashboard"}
              {mode === "signup" && "Get started with Kalshi Watchdog"}
              {mode === "confirm" && "Enter the code sent to your email"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode !== "confirm" && (
              <>
                <div>
                  <label htmlFor="email" className="mb-2 block text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-2xl border border-border-default bg-bg-primary px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="mb-2 block text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-2xl border border-border-default bg-bg-primary px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  />
                  {mode === "signup" && (
                    <p className="mt-2 text-xs text-text-tertiary">
                      Minimum 8 characters
                    </p>
                  )}
                </div>
              </>
            )}

            {mode === "confirm" && (
              <div>
                <label htmlFor="code" className="mb-2 block text-xs font-medium uppercase tracking-wider text-text-tertiary">
                  Confirmation code
                </label>
                <input
                  id="code"
                  type="text"
                  required
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full rounded-2xl border border-border-default bg-bg-primary px-4 py-3 text-center text-lg font-mono tracking-widest text-text-primary placeholder:text-text-muted focus:border-border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                />
                <p className="mt-2 text-xs text-text-tertiary">
                  Check your email for the verification code
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl border border-border-accent bg-[var(--accent-dim)] py-3.5 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? "Processing..."
                : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                ? "Create account"
                : "Verify & continue"}
            </button>
          </form>

          <div className="mt-6 text-center">
            {mode === "signin" && (
              <p className="text-sm text-text-tertiary">
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  Sign up
                </button>
              </p>
            )}
            {mode === "signup" && (
              <p className="text-sm text-text-tertiary">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  Sign in
                </button>
              </p>
            )}
            {mode === "confirm" && (
              <p className="text-sm text-text-tertiary">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  Back to sign in
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-text-tertiary">
          ECU ACM Spark / AWS Track Hackathon Project
        </p>
      </div>
    </div>
  );
}
