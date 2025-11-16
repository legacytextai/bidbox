const Partners = () => {
  // Placeholder partner logos - in production these would be real company logos
  const partners = [
    "Partner 1",
    "Partner 2",
    "Partner 3",
    "Partner 4",
    "Partner 5",
    "Partner 6",
  ];

  return (
    <section className="py-16 bg-secondary/30 border-y border-border">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Trusted by GCs, estimators, and subcontractors nationwide
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 items-center">
          {partners.map((partner, idx) => (
            <div
              key={idx}
              className="flex items-center justify-center h-16 px-4 opacity-60 hover:opacity-100 transition-opacity"
            >
              <div className="w-full h-full bg-muted rounded-lg flex items-center justify-center text-muted-foreground font-medium text-sm">
                {partner}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Partners;
