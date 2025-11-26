import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
const CTA = () => {
  const [email, setEmail] = useState("");
  const {
    toast
  } = useToast();
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    window.location.href = "/auth";
  };
  return <section id="cta" className="py-24 bg-gradient-to-br from-[hsl(var(--bidbox-blue))] to-[hsl(var(--bidbox-blue))]/90 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-grid-pattern opacity-10"></div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          {/* Heading */}
          <h2 className="text-4xl md:text-5xl font-bold text-primary-foreground mb-6">
            Ready to Simplify Your Next Bid?
          </h2>

          <p className="text-xl text-primary-foreground/90 mb-10">Join the top GCs who are spending less time chasing subs and more time winning projects. Start your free 14-day trial — no credit card required.</p>

          {/* Email Capture Form */}
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 max-w-2xl mx-auto mb-8">
            <Input type="email" placeholder="Enter your work email" value={email} onChange={e => setEmail(e.target.value)} required className="flex-1 h-14 px-6 text-lg bg-white/95 border-white/20 text-foreground placeholder:text-muted-foreground" />
            <Button type="submit" size="lg" variant="secondary" className="h-14 px-8 text-lg font-semibold shadow-lg hover:shadow-xl transition-all group">
              Start Free Trial
              <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </form>

          {/* Trust Indicators */}
          <div className="flex flex-wrap justify-center gap-6 text-primary-foreground/80 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-2xl">✓</span>
              <span>14-day free trial</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">✓</span>
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">✓</span>
              <span>Cancel anytime</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">✓</span>
              <span>Setup in 5 minutes</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .bg-grid-pattern {
          background-image: 
            linear-gradient(to right, white 1px, transparent 1px),
            linear-gradient(to bottom, white 1px, transparent 1px);
          background-size: 40px 40px;
        }
      `}</style>
    </section>;
};
export default CTA;