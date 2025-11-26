import { Layout } from "@/components/Layout";
import Hero from "@/components/Hero";
import Partners from "@/components/Partners";
import Benefits from "@/components/Benefits";
import HowItWorks from "@/components/HowItWorks";
import PricingMvp from "@/components/PricingMvp";
import Testimonials from "@/components/Testimonials";
import FAQ from "@/components/FAQ";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";

const LandingMvp = () => {
  return (
    <Layout showSidebar={false}>
      <Hero />
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
