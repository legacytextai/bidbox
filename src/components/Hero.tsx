import { Button } from "@/components/ui/button";
import { CheckCircle2, Users } from "lucide-react";

const Hero = () => {
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <section className="relative pt-32 pb-20 overflow-hidden bg-gradient-to-b from-background to-secondary/30">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>

      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          {/* Social Proof Badge */}
          <div className="flex justify-center mb-8 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/20 rounded-full text-sm font-medium text-primary">
              <Users className="w-4 h-4" />
              <span>1,000+ active users</span>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left: Copy */}
            <div className="space-y-8 animate-slide-in-left">
              <div className="space-y-6">
                <h1 className="text-5xl md:text-6xl font-bold text-foreground leading-tight">
                  The Simple Bid Platform{" "}
                  <span className="text-[hsl(var(--bidbox-blue))]">Built for GCs</span> — Loved by
                  Subs.
                </h1>

                <p className="text-xl text-muted-foreground leading-relaxed">
                  Send bid invites. Track quotes. Get responses — without chasing
                  subs or paying for bloated software.
                </p>
              </div>

              {/* Key Benefits */}
              <div className="space-y-3">
                {[
                  "No logins required — subs just click the link and submit",
                  "SMS + Email invites with auto-reminders before the deadline",
                  "Track who viewed the plans and who ghosted you",
                  "Clean dashboard + one-click Excel export for bid day",
                  "Priced for small GCs: starts at $49/month, no contracts",
                ].map((benefit, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-[hsl(var(--bidbox-blue))] shrink-0 mt-1" />
                    <span className="text-foreground/90">{benefit}</span>
                  </div>
                ))}
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  onClick={() => window.location.href = "/auth"}
                  className="text-lg px-8 shadow-strong hover:shadow-soft transition-all bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
                >
                  Get Started
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => scrollToSection("how-it-works")}
                  className="text-lg px-8"
                >
                  See How It Works
                </Button>
              </div>
            </div>

            {/* Right: Product Preview */}
            <div className="relative animate-slide-in-right">
              <div className="relative rounded-2xl overflow-hidden shadow-strong border border-border bg-card">
                <img
                  src="/placeholder.svg"
                  alt="BidBox Dashboard Preview"
                  className="w-full h-auto"
                />
                {/* Overlay gradient for depth */}
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent pointer-events-none"></div>
              </div>

              {/* Floating badge */}
              <div className="absolute -bottom-4 -left-4 bg-accent text-accent-foreground px-6 py-3 rounded-lg shadow-lg font-semibold">
                5-minute setup ⚡
              </div>
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
    </section>
  );
};

export default Hero;
