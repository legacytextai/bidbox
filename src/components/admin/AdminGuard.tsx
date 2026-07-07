import { ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route guard for the internal Admin section. Redirects
 * non-administrators to the app home. Authorization is the existing
 * user_roles/has_role architecture (see useIsAdmin) — RLS on the
 * underlying tables remains the real security boundary; this guard is
 * UX, not the defense.
 */
export const AdminGuard = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const { user, authReady } = useAuth();
  const { isAdmin, isCheckingAdmin } = useIsAdmin();

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    if (!isCheckingAdmin && !isAdmin) {
      navigate("/calendar");
    }
  }, [authReady, user, isAdmin, isCheckingAdmin, navigate]);

  if (!authReady || isCheckingAdmin) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return <>{children}</>;
};
