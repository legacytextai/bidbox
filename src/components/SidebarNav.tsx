import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FolderOpen, Settings, LogOut, Users, Calendar, Globe, Search, SlidersHorizontal, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { ADMIN_NAV } from "@/components/admin/adminNav";
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
  const { isAdmin } = useIsAdmin();

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
      <div className="px-4 py-4 border-b border-border flex items-center justify-center">
        <img src={bidboxLogo} alt="BidBox" className="w-full h-auto max-h-16 object-contain" />
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
                  <span>My Projects</span>
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

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ADMIN_NAV.map((item) => (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton onClick={() => handleNavigation(item.path)}>
                      <item.icon className="h-4 w-4 mr-3" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
