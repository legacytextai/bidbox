import { Star } from "lucide-react";

const Testimonials = () => {
  const testimonials = [
    {
      quote:
        "I spend half my week tracking down subcontractors who never logged in to Procore. BidBox changed that overnight.",
      author: "Mike Rodriguez",
      title: "Project Manager",
      company: "Rodriguez Construction",
      rating: 5,
    },
    {
      quote:
        "Most bid tools are built for huge GCs with full estimating departments — we're just 3 guys trying to get quotes. BidBox gets it.",
      author: "Sarah Chen",
      title: "Owner",
      company: "Chen Builders",
      rating: 5,
    },
    {
      quote:
        "Subs ghost us when they have to make accounts or download 50MB of PDFs. Now they just click and bid. Response rate went up 40%.",
      author: "James Thompson",
      title: "Estimator",
      company: "Thompson GC",
      rating: 5,
    },
    {
      quote:
        "The Excel export alone is worth the price. On bid day, I look like a pro instead of scrambling through email threads.",
      author: "Lisa Martinez",
      title: "Operations Manager",
      company: "Martinez Construction Group",
      rating: 5,
    },
  ];

  return (
    <section id="testimonials" className="py-24 bg-secondary/30">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
            Loved by Small GCs Nationwide
          </h2>
          <p className="text-xl text-muted-foreground">
            Real teams. Real results. See why contractors are switching to BidBox.
          </p>
        </div>

        {/* Testimonial Grid */}
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {testimonials.map((testimonial, idx) => (
            <div
              key={idx}
              className="bg-card p-8 rounded-2xl border border-border hover:shadow-strong transition-all duration-300"
            >
              {/* Rating Stars */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star
                    key={i}
                    className="w-5 h-5 fill-accent text-accent"
                  />
                ))}
              </div>

              {/* Quote */}
              <blockquote className="text-lg text-foreground/90 mb-6 leading-relaxed">
                "{testimonial.quote}"
              </blockquote>

              {/* Author Info */}
              <div className="flex items-center gap-4">
                {/* Avatar Placeholder */}
                <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center text-primary font-bold text-lg">
                  {testimonial.author.charAt(0)}
                </div>

                <div>
                  <div className="font-semibold text-foreground">
                    {testimonial.author}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {testimonial.title}, {testimonial.company}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
