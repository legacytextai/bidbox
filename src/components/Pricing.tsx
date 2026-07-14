import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

const Pricing = () => {
  const plans = [
    {
      name: "Starter",
      price: "$49",
      period: "/month",
      description: "Perfect for small GCs just getting started",
      features: [
        "Up to 5 active projects",
        "25 invites per month",
        "Email & SMS invites",
        "Basic analytics",
        "Excel export",
      ],
      cta: "Start Free Trial",
      popular: false,
    },
    {
      name: "Growth",
      price: "$99",
      period: "/month",
      description: "Most popular for growing teams",
      features: [
        "Unlimited projects",
        "100 invites per month",
        "Email & SMS invites",
        "Advanced tracking",
        "Priority support",
        "Custom branding",
      ],
      cta: "Start Free Trial",
      popular: true,
    },
    {
      name: "Pro",
      price: "$199",
      period: "/month",
      description: "For established GCs managing multiple bids",
      features: [
        "Everything in Growth",
        "Unlimited invites",
        "Multi-user accounts",
        "API access",
        "Dedicated support",
        "Custom integrations",
      ],
      cta: "Start Free Trial",
      popular: false,
    },
  ];

  const goToSignup = () => {
    window.location.href = "/auth?mode=signup";
  };

  return (
    <section id="pricing" className="py-24 bg-background">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
            Pricing That Makes Sense
          </h2>
          <p className="text-xl text-muted-foreground">
            No contracts. No setup fees. Cancel anytime. Start with a 14-day free trial.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {plans.map((plan, idx) => (
            <div
              key={idx}
              className={`relative p-8 rounded-2xl border transition-all duration-300 ${
                plan.popular
                  ? "bg-[hsl(var(--bidbox-blue))] text-white border-[hsl(var(--bidbox-blue))] shadow-strong scale-105"
                  : "bg-card text-card-foreground border-border hover:shadow-soft"
              }`}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground px-4 py-1 rounded-full text-sm font-semibold">
                  Most Popular
                </div>
              )}

              {/* Plan Name */}
              <h3
                className={`text-2xl font-bold mb-2 ${
                  plan.popular ? "text-white" : "text-foreground"
                }`}
              >
                {plan.name}
              </h3>

              {/* Description */}
              <p
                className={`text-sm mb-6 ${
                  plan.popular
                    ? "text-white/90"
                    : "text-muted-foreground"
                }`}
              >
                {plan.description}
              </p>

              {/* Price */}
              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span
                    className={`text-5xl font-bold ${
                      plan.popular
                        ? "text-white"
                        : "text-foreground"
                    }`}
                  >
                    {plan.price}
                  </span>
                  <span
                    className={`text-lg ${
                      plan.popular
                        ? "text-white/80"
                        : "text-muted-foreground"
                    }`}
                  >
                    {plan.period}
                  </span>
                </div>
              </div>

              {/* CTA Button */}
              <Button
                onClick={goToSignup}
                className={`w-full mb-8 ${plan.popular ? "bg-white text-[hsl(var(--bidbox-blue))] hover:bg-white/90" : "bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"}`}
                size="lg"
              >
                {plan.cta}
              </Button>

              {/* Features */}
              <ul className="space-y-4">
                {plan.features.map((feature, featureIdx) => (
                  <li key={featureIdx} className="flex items-start gap-3">
                    <Check
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        plan.popular
                          ? "text-white"
                          : "text-[hsl(var(--bidbox-blue))]"
                      }`}
                    />
                    <span
                      className={
                        plan.popular
                          ? "text-white/90"
                          : "text-foreground/90"
                      }
                    >
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Note */}
        <p className="text-center text-muted-foreground mt-12">
          All plans include a 14-day free trial. No credit card required.
        </p>
      </div>
    </section>
  );
};

export default Pricing;
