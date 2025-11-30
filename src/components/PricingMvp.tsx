import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

const PricingMvp = () => {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

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
      action: "free",
    },
    {
      name: "Early Access Lifetime — $199",
      price: "$199",
      period: "/one-time",
      description: "Limited offer",
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
      action: "checkout",
    },
  ];

  const handleCheckout = async () => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in to purchase a subscription",
        variant: "destructive",
      });
      navigate("/auth");
      return;
    }

    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout");

      if (error) {
        throw error;
      }

      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      console.error("Checkout error:", err);
      toast({
        title: "Checkout Error",
        description: err.message || "Failed to start checkout",
        variant: "destructive",
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handlePlanAction = (action: string) => {
    if (action === "checkout") {
      handleCheckout();
    } else if (action === "free") {
      if (user) {
        navigate("/projects");
      } else {
        navigate("/auth");
      }
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
              className={`relative rounded-2xl p-8 flex flex-col ${
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
                    plan.featured 
                      ? "bg-white text-black font-extralight px-4 py-2 rounded-full inline-block" 
                      : "text-foreground font-light"
                  }
                >
                  {plan.description}
                </p>
              </div>

              <div className="mb-8 flex-1">
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
                onClick={() => handlePlanAction(plan.action)}
                disabled={plan.action === "checkout" && checkoutLoading}
              >
                {plan.action === "checkout" && checkoutLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  plan.cta
                )}
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
