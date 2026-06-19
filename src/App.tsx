import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import LandingFull from "./pages/LandingFull";
import LandingMvp from "./pages/LandingMvp";
import LandingV1 from "./pages/LandingV1";
import Auth from "./pages/Auth";
import Projects from "./pages/Projects";
import NewProject from "./pages/NewProject";
import ProjectDetail from "./pages/ProjectDetail";
import BidRoom from "./pages/BidRoom";
import Settings from "./pages/Settings";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import AdminAnalytics from "./pages/AdminAnalytics";
import AdminNetworkSubs from "./pages/AdminNetworkSubs";
import SubcontractorDirectory from "./pages/SubcontractorDirectory";
import CalendarDashboard from "./pages/CalendarDashboard";
import SubsNetwork from "./pages/SubsNetwork";
import Opportunities from "./pages/Opportunities";
import OpportunityReport from "./pages/OpportunityReport";
import QualificationProfile from "./pages/QualificationProfile";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingMvp />} />
            <Route path="/landing-mvp" element={<LandingMvp />} />
            <Route path="/landing-v1" element={<LandingV1 />} />
            <Route path="/landing-full" element={<LandingFull />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/calendar" element={<CalendarDashboard />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/opportunities/:id" element={<OpportunityReport />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/new" element={<NewProject />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/bid/:token" element={<BidRoom />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/profile" element={<QualificationProfile />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/admin/analytics" element={<AdminAnalytics />} />
            <Route path="/admin/network-subs" element={<AdminNetworkSubs />} />
            <Route path="/settings/subcontractors" element={<SubcontractorDirectory />} />
            <Route path="/subs-network" element={<SubsNetwork />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
