import { Layout } from "@/components/Layout";
import Hero from "@/components/Hero";
import Partners from "@/components/Partners";
import Benefits from "@/components/Benefits";
import HowItWorks from "@/components/HowItWorks";
import Pricing from "@/components/Pricing";
import Testimonials from "@/components/Testimonials";
import FAQ from "@/components/FAQ";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";

const LandingFull = () => {
  return (
    <Layout showSidebar={false}>
      <Hero />
      <Partners />
      <Benefits />
      <HowItWorks />
      <Pricing />
      <Testimonials />
      <FAQ />
      <CTA />
      <Footer />
    </Layout>
  );
};

export default LandingFull;
