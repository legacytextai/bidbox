import {
  Zap,
  Target,
  TrendingUp,
  Shield,
  Clock,
  Smile,
} from "lucide-react";

const Benefits = () => {
  const benefits = [
    {
      icon: Zap,
      title: "Lightning-Fast Setup",
      description:
        "Launch your first bid invite in under 5 minutes. No complex onboarding, no training required.",
    },
    {
      icon: Target,
      title: "Higher Response Rates",
      description:
        "Subs actually respond when they don't need to create accounts or download massive files.",
    },
    {
      icon: TrendingUp,
      title: "Better Bid Day Prep",
      description:
        "Know exactly who's bidding before deadline day. Export to Excel with one click.",
    },
    {
      icon: Shield,
      title: "Professional Image",
      description:
        "Look like a $50M GC while running a lean 3-person team. Organized, trackable, reliable.",
    },
    {
      icon: Clock,
      title: "Save 10+ Hours Per Bid",
      description:
        "Stop chasing subs via text and email. Automated reminders and tracking do it for you.",
    },
    {
      icon: Smile,
      title: "Subs Love It",
      description:
        "No login barriers means happier subs and faster quotes. Win-win for everyone.",
    },
  ];

  return (
    <section id="benefits" className="py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
            Built for How You Actually Work
          </h2>
          <p className="text-xl text-muted-foreground">
            Focus on winning projects, not wrestling with software designed for
            enterprise teams.
          </p>
        </div>

        {/* Bento Box Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {benefits.map((benefit, idx) => (
            <div
              key={idx}
              className="group p-8 bg-card border border-border rounded-2xl hover:shadow-strong hover:border-[hsl(var(--bidbox-blue))]/30 transition-all duration-300"
            >
              <div className="mb-6">
                <div className="w-14 h-14 bg-[hsl(var(--bidbox-blue))]/10 rounded-xl flex items-center justify-center group-hover:bg-[hsl(var(--bidbox-blue))]/20 transition-colors">
                  <benefit.icon className="w-7 h-7 text-[hsl(var(--bidbox-blue))]" />
                </div>
              </div>

              <h3 className="text-xl font-semibold text-foreground mb-3">
                {benefit.title}
              </h3>

              <p className="text-muted-foreground leading-relaxed">
                {benefit.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Benefits;
