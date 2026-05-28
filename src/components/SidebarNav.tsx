import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FolderOpen, Settings, LogOut, Users, Calendar, Globe, Search, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import bidboxLogo from "@/assets/bidbox-logo.png";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";

interface SidebarNavProps {
  onNavigate?: () => void;
}

const AppSidebar = ({ onNavigate }: SidebarNavProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      console.error("Logout error:", error);
      
      // session_not_found means user is already logged out - treat as success
      if (error.message?.includes("session_not_found") || 
          error.message?.includes("Session from session_id")) {
        navigate("/auth");
        return;
      }
      
      // For other errors, show toast but still redirect
      toast({
        title: "Error",
        description: "Failed to log out. Redirecting anyway...",
        variant: "destructive",
      });
    }
    
    // Always navigate to auth page
    navigate("/auth");
  };

  const handleNavigation = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <Sidebar>
      <div className="px-6 py-3 border-b border-border flex items-center justify-start">
        <img src={bidboxLogo} alt="BidBox" className="h-24 w-auto" />
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => handleNavigation("/calendar")}>
                  <Calendar className="h-4 w-4 mr-3" />
                  <span>Calendar</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => handleNavigation("/projects")}>
                  <FolderOpen className="h-4 w-4 mr-3" />
                  <span>Projects</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => handleNavigation("/opportunities")}>
                  <Search className="h-4 w-4 mr-3" />
                  <span>Opportunities</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => handleNavigation("/settings/subcontractors")}>
                  <Users className="h-4 w-4 mr-3" />
                  <span>My Subs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => handleNavigation("/subs-network")}>
                  <Globe className="h-4 w-4 mr-3" />
                  <span>Subs Network</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => handleNavigation("/settings/profile")}>
              <SlidersHorizontal className="h-4 w-4 mr-3" />
              <span>Bid Profile</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => handleNavigation("/settings")}>
              <Settings className="h-4 w-4 mr-3" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton 
              onClick={handleLogout}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4 mr-3" />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AppSidebar;
