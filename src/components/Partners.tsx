import usaMap from "@/assets/usa-map.png";

const Partners = () => {
  // Placeholder partner logos - in production these would be real company logos
  const partners = ["Partner 1", "Partner 2", "Partner 3", "Partner 4", "Partner 5", "Partner 6"];
  return <section className="py-16 bg-secondary/30 border-y border-border">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Trusted by GCs, estimators, and subcontractors nationwide
          </p>
          <div className="flex justify-center mt-4">
            <img src={usaMap} alt="United States" className="w-24 h-24 object-contain" />
          </div>
        </div>

        
      </div>
    </section>;
};
export default Partners;