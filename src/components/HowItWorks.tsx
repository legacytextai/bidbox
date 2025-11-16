import { Upload, Send, BarChart3 } from "lucide-react";

const HowItWorks = () => {
  const steps = [
    {
      icon: Upload,
      number: "01",
      title: "Upload Your Plans & Scope",
      description:
        "Drag and drop your bid documents. Add project details in seconds.",
    },
    {
      icon: Send,
      number: "02",
      title: "Invite Subs via Email or SMS",
      description:
        "Send professional invites with one click. Automatic reminders keep everyone on track.",
    },
    {
      icon: BarChart3,
      number: "03",
      title: "Track & Export Bids",
      description:
        "See who viewed, who responded, and export everything to Excel for bid day.",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 bg-secondary/30">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
            Get Started in 3 Simple Steps
          </h2>
          <p className="text-xl text-muted-foreground">
            From upload to export in minutes, not hours. Built for speed and simplicity.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {steps.map((step, idx) => (
            <div
              key={idx}
              className="relative bg-card p-8 rounded-2xl border border-border hover:shadow-strong transition-all duration-300"
            >
              {/* Step Number Background */}
              <div className="absolute top-8 right-8 text-7xl font-bold text-primary/5">
                {step.number}
              </div>

              {/* Icon */}
              <div className="relative mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-xl flex items-center justify-center shadow-soft">
                  <step.icon className="w-8 h-8 text-primary-foreground" />
                </div>
              </div>

              {/* Content */}
              <h3 className="text-2xl font-semibold text-foreground mb-4">
                {step.title}
              </h3>

              <p className="text-muted-foreground leading-relaxed">
                {step.description}
              </p>

              {/* Connector Line (except last item) */}
              {idx < steps.length - 1 && (
                <div className="hidden md:block absolute top-16 -right-4 w-8 h-px bg-border z-10"></div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
