import { Amplify } from "aws-amplify";
import {
  confirmSignUp,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
  signUp,
} from "aws-amplify/auth";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Auth disabled for demo
const AUTH_ENABLED = false;

const userPoolId = import.meta.env.VITE_USER_POOL_ID as string | undefined;
const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID as string | undefined;

if (AUTH_ENABLED && userPoolId && userPoolClientId) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
      },
    },
  });
}

export interface AuthUser {
  userId: string;
  email: string;
  isAdmin: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loading: boolean;
  idToken: string | null;
  doSignIn: (email: string, password: string) => Promise<void>;
  doSignUp: (email: string, password: string) => Promise<void>;
  doConfirmSignUp: (email: string, code: string) => Promise<void>;
  doSignOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Auth disabled for demo
    if (!AUTH_ENABLED) {
      setLoading(false);
      return;
    }
    // If Cognito isn't configured (local dev without env vars), skip auth
    if (!userPoolId || !userPoolClientId) {
      setLoading(false);
      return;
    }
    try {
      const current = await getCurrentUser();
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString() ?? null;
      const payload = session.tokens?.idToken?.payload ?? {};
      const groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
      setUser({
        userId: current.userId,
        email: (payload.email as string) ?? current.username,
        isAdmin: groups.includes("admin"),
      });
      setIdToken(token);
    } catch {
      setUser(null);
      setIdToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function doSignIn(email: string, password: string) {
    await signIn({ username: email, password });
    await refresh();
  }

  async function doSignUp(email: string, password: string) {
    await signUp({ username: email, password, options: { userAttributes: { email } } });
  }

  async function doConfirmSignUp(email: string, code: string) {
    await confirmSignUp({ username: email, confirmationCode: code });
  }

  async function doSignOut() {
    await signOut();
    setUser(null);
    setIdToken(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isAdmin: user?.isAdmin ?? false,
        loading,
        idToken,
        doSignIn,
        doSignUp,
        doConfirmSignUp,
        doSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
