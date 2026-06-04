import { Button } from "@/components/ui/button";
import { CheckCircle2, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
const HeroMvp = () => {
  const navigate = useNavigate();
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  };
  return <section className="relative pt-6 pb-8 overflow-hidden bg-gradient-to-b from-background to-secondary/30">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-grid-pattern opacity-5 pointer-events-none"></div>

      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          {/* Social Proof Badge */}
          <div className="flex justify-center mb-4 animate-fade-in">
            
          </div>

          {/* Main Content Grid */}
          <div className="grid md:grid-cols-2 gap-8 items-center">
            {/* Left: Copy */}
            <div className="space-y-4 animate-slide-in-left">
              <div className="space-y-4">
              <h1 className="text-4xl md:text-5xl font-bold leading-tight">
                <span className="text-black dark:text-white">The </span>
                <span className="text-[hsl(var(--bidbox-blue))]">AI-Powered Bid Desk</span>
                <span className="text-black dark:text-white"> for Public Works General Contractors.</span>
              </h1>

                <p className="text-xl text-muted-foreground leading-relaxed">
                  Purpose-built AI agents handle the tedious work — from finding projects to submitting bids. <br />
                  <strong>Bid 2–3x more projects, with more confidence, without adding headcount.</strong>
                </p>
              </div>

              {/* Key Benefits */}
              <div className="space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[hsl(var(--bidbox-blue))] shrink-0 mt-1" />
                <span className="text-foreground/90">Sign up for your <strong>free account</strong></span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[hsl(var(--bidbox-blue))] shrink-0 mt-1" />
                <span className="text-foreground/90">Set up your first project in <strong>under 2 minutes</strong></span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[hsl(var(--bidbox-blue))] shrink-0 mt-1" />
                <span className="text-foreground/90">Share your Bid Room link with anyone, <strong>no login required</strong></span>
              </div>
                {/* Final tagline without checkmark */}
                <div className="pt-2">
                  
                </div>
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" onClick={() => navigate("/auth")} className="text-lg px-8 shadow-strong hover:shadow-soft transition-all bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90">
                  Create Your Bid Room
                </Button>
                <Button size="lg" variant="outline" onClick={() => scrollToSection("how-it-works")} className="text-lg px-8 hover:bg-transparent hover:border-[hsl(var(--bidbox-blue))] hover:text-[hsl(var(--bidbox-blue))] transition-colors">
                  See How It Works
                </Button>
              </div>
            </div>

            {/* Right: Product Preview */}
            <div className="relative animate-slide-in-right">
              <div className="relative rounded-2xl overflow-hidden shadow-strong border border-border bg-card">
                <video src="/videos/bidbox-demo.mov" autoPlay loop muted playsInline className="w-full h-auto" />
                {/* Overlay gradient for depth */}
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent pointer-events-none"></div>
              </div>

              {/* Floating badge */}
              <div className="absolute -bottom-4 -right-4 bg-accent text-accent-foreground px-6 py-3 rounded-lg shadow-lg font-semibold">2-minute setup ⚡</div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slide-in-left {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-in-right {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.6s ease-out;
        }
        .animate-slide-in-left {
          animation: slide-in-left 0.8s ease-out;
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.8s ease-out 0.2s both;
        }
        .bg-grid-pattern {
          background-image: 
            linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px);
          background-size: 40px 40px;
        }
      `}</style>
    </section>;
};
export default HeroMvp;