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
              <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight">
                  <span className="text-[hsl(var(--bidbox-blue))]">Send One Link.</span> Get More Quotes.
                  <br />
                  <span className="text-2xl md:text-3xl font-medium mt-2 block">BidBox is the <span className="text-foreground">Simple Bid Room Built For GCs</span> <span className="text-foreground">— Loved By Subs.</span></span>
                </h1>

              <p className="text-xl leading-relaxed"><span className="text-muted-foreground">Stop chasing subcontractors. Stop wrestling with overbuilt software.</span> <span className="text-foreground font-semibold">Just upload your plans, send one link, and watch the quotes roll in.</span></p>
              </div>

              {/* Key Benefits */}
              <div className="space-y-3">
                {["Create a bid room in seconds", "Share one link with all your subs", "Subs open your bid room instantly — no accounts", "They view/download your project files", "They upload their quote back to you"].map((benefit, idx) => <div key={idx} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-[hsl(var(--bidbox-blue))] shrink-0 mt-1" />
                    <span className="text-foreground/90">{benefit}</span>
                  </div>)}
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" onClick={() => navigate("/auth")} className="text-lg px-8 shadow-strong hover:shadow-soft transition-all bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90">
                  Try It Free
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