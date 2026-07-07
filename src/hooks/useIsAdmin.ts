import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Admin authorization check for the internal Admin section.
 *
 * Uses the existing role architecture: user_roles + has_role()
 * (SECURITY DEFINER, migration 20251130211130). No emails are
 * hardcoded anywhere in the app — admins are user_roles rows.
 * Shares the "admin-check" query key with useAdminKPIs so the
 * result is cached once per session.
 */
export function useIsAdmin() {
  const { user } = useAuth();

  const { data: isAdmin, isLoading: isCheckingAdmin } = useQuery({
    queryKey: ["admin-check", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (error) {
        console.error("Error checking admin role:", error);
        return false;
      }
      return data === true;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  return { isAdmin: isAdmin === true, isCheckingAdmin };
}
