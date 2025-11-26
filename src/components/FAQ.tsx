import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ = () => {
  const faqs = [
    {
      question: "Do I really not need a credit card for the free tier?",
      answer:
        "Correct. Start your Free Tier Bid Room with just your email. We'll only ask for payment details when you're ready to upgrade.",
    },
    {
      question: "Do subcontractors need to create accounts?",
      answer:
        "Nope. That's the whole point. Subs receive a unique link via email or SMS, click it, and submit their quote. No logins, no passwords, no friction.",
    },
    {
      question: "Can I cancel anytime?",
      answer:
        "Absolutely. No contracts, no commitments. Cancel anytime from your account settings. We're confident you'll love it, but if not, no hard feelings.",
    },
    {
      question: "Is my data secure and backed up?",
      answer:
        "Yes. All data is encrypted in transit and at rest. We use enterprise-grade cloud infrastructure with automatic daily backups. Your bid documents and quotes are safe with us.",
    },
    {
      question: "Can I export my data if I decide to leave?",
      answer:
        "Of course. Export all your projects, contacts, and bid data to Excel or CSV anytime. Your data is your data — we'll never hold it hostage.",
    },
  ];

  return (
    <section id="faq" className="py-24 bg-background">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
            Frequently Asked Questions
          </h2>
          <p className="text-xl text-muted-foreground">
            Got questions? We've got answers. Can't find what you're looking for?{" "}
            <a href="#cta" className="text-primary hover:underline">
              Get in touch
            </a>
            .
          </p>
        </div>

        {/* FAQ Accordion */}
        <div className="max-w-3xl mx-auto">
          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, idx) => (
              <AccordionItem
                key={idx}
                value={`item-${idx}`}
                className="bg-card border border-border rounded-xl px-6 shadow-sm hover:shadow-soft transition-all"
              >
                <AccordionTrigger className="text-left text-lg font-semibold text-foreground hover:text-primary hover:no-underline py-6">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed pb-6">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default FAQ;
