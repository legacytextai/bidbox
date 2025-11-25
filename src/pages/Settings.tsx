import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";

const Settings = () => {
  const [profile, setProfile] = useState<any>(null);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();

    if (data) {
      setProfile(data);
      setCompanyName(data.company_name || "");
    }
    setLoading(false);
  };

  const updateProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from("profiles")
      .update({ company_name: companyName })
      .eq("id", session.user.id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to update profile",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Profile updated successfully",
      });
      loadProfile();
    }
  };

  if (loading) {
    return (
      <Layout showSidebar={true}>
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout showSidebar={true}>
      <div className="p-8">
          <h1 className="text-3xl font-bold text-foreground mb-8">Settings</h1>

          <div className="max-w-2xl space-y-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold text-foreground mb-4">
                Profile Information
              </h2>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={profile?.email || ""} disabled />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Company Name</Label>
                  <Input
                    id="company"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>

                <Button onClick={updateProfile}>Save Changes</Button>
              </div>
            </div>
          </div>
        </div>
    </Layout>
  );
};

export default Settings;
