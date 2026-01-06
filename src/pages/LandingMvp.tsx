import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import HeroMvp from "@/components/HeroMvp";
import Partners from "@/components/Partners";
import Benefits from "@/components/Benefits";
import HowItWorks from "@/components/HowItWorks";
import PricingMvp from "@/components/PricingMvp";
import Testimonials from "@/components/Testimonials";
import FAQ from "@/components/FAQ";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";
import { useAuth } from "@/hooks/useAuth";

const LandingMvp = () => {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authReady && user) {
      navigate("/calendar", { replace: true });
    }
  }, [authReady, user, navigate]);

  // Prevent flash of landing content while checking auth
  if (!authReady) {
    return null;
  }
  return (
    <Layout showSidebar={false}>
      <HeroMvp />
      <Partners />
      <Benefits />
      <HowItWorks />
      <PricingMvp />
      <Testimonials />
      <FAQ />
      <CTA />
      <Footer />
    </Layout>
  );
};

export default LandingMvp;
