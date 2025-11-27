import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

const PricingMvp = () => {
  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "/month",
      description: "Perfect for small GCs trying BidBox for the first time",
      features: [
        "3 active bid rooms",
        "Core file sharing",
        "Unlimited subcontractor access",
        "No email invites",
        "No advanced features",
      ],
      cta: "Start Free",
      popular: false,
      featured: false,
    },
    // SAVED FOR LATER - Tier 1 subscription plan
    // {
    //   name: "Tier 1",
    //   price: "$49",
    //   period: "/month",
    //   description: "Best for growing estimators who need more flexibility",
    //   features: [
    //     "Unlimited bid rooms",
    //     "Unlimited file uploads",
    //     "Unlimited subcontractor submissions",
    //     "Basic admin dashboard",
    //     "Simple, fast workflow",
    //   ],
    //   cta: "Start Free Trial",
    //   popular: true,
    // },
    {
      name: "Early Access Lifetime — $199",
      price: "$199",
      period: "/one-time",
      description: "Limited offer — first 50 GCs only",
      features: [
        "Lifetime unlimited bid rooms",
        "Lifetime unlimited uploads",
        "All MVP features included",
        "Priority access to new features",
        "Never pay monthly fees",
      ],
      cta: "Claim Lifetime Access",
      popular: false,
      featured: true,
    },
  ];

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="py-24 bg-background" id="pricing">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Pricing That Makes Sense
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits your workflow
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`relative rounded-2xl p-8 ${
                plan.featured
                  ? "bg-black text-white shadow-xl"
                  : "bg-card border border-border"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground px-4 py-1 rounded-full text-sm font-medium">
                  Most Popular
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                <p
                  className={
                    plan.featured ? "text-white font-light" : "text-foreground font-light"
                  }
                >
                  {plan.description}
                </p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-bold">{plan.price}</span>
                  <span
                    className={
                      plan.featured ? "text-white/70" : "text-muted-foreground"
                    }
                  >
                    {plan.period}
                  </span>
                </div>
              </div>

              <Button
                className={`w-full mb-8 ${
                  plan.featured
                    ? "bg-white text-black hover:bg-white/90"
                    : ""
                }`}
                size="lg"
                onClick={() => scrollToSection("cta")}
              >
                {plan.cta}
              </Button>

              <ul className="space-y-4">
                {plan.features.map((feature, featureIndex) => (
                  <li key={featureIndex} className="flex items-start gap-3">
                    <Check
                      className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                        plan.featured ? "text-white" : "text-primary"
                      }`}
                    />
                    <span
                      className={
                        plan.featured ? "text-white" : "text-foreground"
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
      </div>
    </section>
  );
};

export default PricingMvp;
