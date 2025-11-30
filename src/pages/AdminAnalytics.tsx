import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAdminKPIs } from "@/hooks/useAdminKPIs";
import { KPIGrid } from "@/components/admin/KPIGrid";
import { GCMetricsTable } from "@/components/admin/GCMetricsTable";

export default function AdminAnalytics() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const {
    isAdmin,
    isCheckingAdmin,
    kpiSummary,
    isLoadingKPIs,
    kpiError,
    gcMetrics,
    isLoadingGCMetrics,
    gcMetricsError,
    refetch,
  } = useAdminKPIs();

  // Redirect non-authenticated users
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [authLoading, user, navigate]);

  // Redirect non-admin users
  useEffect(() => {
    if (!isCheckingAdmin && isAdmin === false) {
      navigate("/projects");
    }
  }, [isCheckingAdmin, isAdmin, navigate]);

  // Show loading while checking auth/admin status
  if (authLoading || isCheckingAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verifying access...</p>
        </div>
      </div>
    );
  }

  // Guard - don't render if not admin
  if (!isAdmin) {
    return null;
  }

  const hasError = kpiError || gcMetricsError;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/projects")}
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Projects
              </Button>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                <h1 className="text-xl font-semibold text-foreground">Admin Analytics</h1>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoadingKPIs || isLoadingGCMetrics}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${(isLoadingKPIs || isLoadingGCMetrics) ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {hasError ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
            <p className="text-destructive font-medium mb-4">
              Failed to load analytics data. Please try again.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* KPI Grid */}
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-4">
                Platform Overview
              </h2>
              <KPIGrid data={kpiSummary} isLoading={isLoadingKPIs} />
            </section>

            {/* GC Metrics Table */}
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-4">
                GC Breakdown
              </h2>
              <GCMetricsTable data={gcMetrics} isLoading={isLoadingGCMetrics} />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
