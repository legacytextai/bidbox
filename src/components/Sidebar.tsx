import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FolderOpen, Plus, Settings, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const Sidebar = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        title: "Error",
        description: "Failed to log out",
        variant: "destructive",
      });
    } else {
      navigate("/auth");
    }
  };

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      <div className="p-6">
        <h2 className="text-2xl font-bold text-primary">BB</h2>
      </div>

      <nav className="flex-1 px-4 space-y-2">
        <div className="mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
            Projects
          </p>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => navigate("/projects")}
          >
            <FolderOpen className="h-4 w-4 mr-3" />
            View All
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => navigate("/projects/new")}
          >
            <Plus className="h-4 w-4 mr-3" />
            Add New
          </Button>
        </div>
      </nav>

      <div className="p-4 space-y-2 border-t border-border">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => navigate("/settings")}
        >
          <Settings className="h-4 w-4 mr-3" />
          Settings
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-3" />
          Logout
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
