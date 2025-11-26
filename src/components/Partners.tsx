import partnerLogos from "@/assets/partner-logos.png";

const Partners = () => {
  return <section className="py-16 bg-secondary/30 border-y border-border">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Trusted by GCs, estimators, and subcontractors nationwide
          </p>
        </div>

        <div className="flex justify-center">
          <img 
            src={partnerLogos} 
            alt="Partner company logos" 
            className="max-w-[50%] h-auto"
          />
        </div>
      </div>
    </section>;
};
export default Partners;