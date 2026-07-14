import { useState, useEffect, useMemo, createContext, useContext, ReactNode, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authReady: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  authReady: false,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const nextUserId = session?.user.id ?? null;
        if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
          queryClient.clear();
          for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key?.startsWith("bidbox:")) sessionStorage.removeItem(key);
          }
        }
        previousUserId.current = nextUserId;
        setUser(session?.user ?? null);
        setAuthReady(true);
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      previousUserId.current = session?.user.id ?? null;
      setUser(session?.user ?? null);
      setAuthReady(true);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  // Memoize the context value so consumers don't see a new object reference
  // on every AuthProvider render — otherwise downstream `useEffect` hooks that
  // depend on `user` re-fire on unrelated auth-listener ticks (e.g. TOKEN_REFRESHED)
  // and can pin pages to a `loading===true` state.
  const value = useMemo(() => ({ user, loading, authReady }), [user, loading, authReady]);
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
