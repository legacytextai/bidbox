import { ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Menu, User, Settings, LogOut } from "lucide-react";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import AppSidebar from "@/components/SidebarNav";

interface LayoutProps {
  children: ReactNode;
  showSidebar?: boolean;
}

const AuthButtons = () => {
  const { user, loading, authReady } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        title: "Error",
        description: "Failed to sign out",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Signed out successfully",
      });
      navigate("/auth");
    }
  };

  if (!authReady || loading) {
    return <Skeleton className="h-9 w-9 rounded-full" />;
  }

  if (user) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="relative h-9 w-9 rounded-full bg-white text-primary hover:bg-white/90"
          >
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-white text-primary">
                {user.email?.charAt(0).toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-card">
          <DropdownMenuItem asChild>
            <Link to="/projects" className="flex items-center cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              Dashboard
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings" className="flex items-center cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="ghost"
        onClick={() => navigate("/auth")}
        className="text-white hover:bg-white/10"
      >
        Sign In
      </Button>
      <Button
        onClick={() => navigate("/auth")}
        className="bg-accent hover:bg-accent/90"
      >
        Start Free Trial
      </Button>
    </div>
  );
};

const SidebarLayout = ({ children }: { children: ReactNode }) => {
  const isMobile = useIsMobile();
  const { toggleSidebar } = useSidebar();

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar />
      
      <div className="flex-1 flex flex-col">
        <header className="sticky top-0 z-50 border-b border-white/10 bg-primary">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              {isMobile && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleSidebar}
                  className="lg:hidden text-white hover:bg-white/10"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              )}
              <Link
                to="/projects"
                className="text-xl sm:text-2xl font-bold text-white hover:opacity-80 transition-opacity"
              >
                BidBox
              </Link>
            </div>
            
            <AuthButtons />
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

const PublicLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-primary">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="text-xl sm:text-2xl font-bold text-white hover:opacity-80 transition-opacity"
          >
            BidBox
          </Link>
          
          <AuthButtons />
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>
    </div>
  );
};

export const Layout = ({ children, showSidebar = false }: LayoutProps) => {
  if (showSidebar) {
    return (
      <SidebarProvider>
        <SidebarLayout>{children}</SidebarLayout>
      </SidebarProvider>
    );
  }

  return <PublicLayout>{children}</PublicLayout>;
};
