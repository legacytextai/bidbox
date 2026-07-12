import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AdminGuard } from "@/components/admin/AdminGuard";

interface Lead {
  id: string;
  email: string;
  form_type: "guide" | "trial_request" | "newsletter";
  source_path: string | null;
  created_at: string;
}

const tagStyles: Record<Lead["form_type"], string> = {
  guide: "bg-blue-100 text-blue-800",
  trial_request: "bg-orange-100 text-orange-800",
  newsletter: "bg-gray-100 text-gray-800",
};

const AdminLeadsContent = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("landing_leads")
        .select("id,email,form_type,source_path,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) setError(error.message);
      else setLeads((data ?? []) as Lead[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Landing page leads</h1>
      <p className="text-sm text-muted-foreground mb-6">
        All submissions from the marketing landing page. Newest first.
      </p>
      {loading && <p>Loading…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}
      {!loading && !error && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3">Submitted</th>
                <th className="text-left p-3">Tag</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Source</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 && (
                <tr><td className="p-3 text-muted-foreground" colSpan={4}>No submissions yet.</td></tr>
              )}
              {leads.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-3 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${tagStyles[l.form_type]}`}>
                      {l.form_type}
                    </span>
                  </td>
                  <td className="p-3">{l.email}</td>
                  <td className="p-3 text-muted-foreground">{l.source_path ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const AdminLeads = () => {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authReady && !user) navigate("/auth", { replace: true });
  }, [authReady, user, navigate]);

  if (!authReady || !user) return null;

  return (
    <AdminGuard>
      <AdminLeadsContent />
    </AdminGuard>
  );
};

export default AdminLeads;
