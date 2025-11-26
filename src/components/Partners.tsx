import logoNorthworks from "@/assets/logo-northworks.png";
import logoWestbuild from "@/assets/logo-westbuild.png";
import logoMetroworks from "@/assets/logo-metroworks.png";
import logoPrimesite from "@/assets/logo-primesite.png";
import logoBluepeak from "@/assets/logo-bluepeak.png";

const Partners = () => {
  return (
    <section className="py-16 bg-secondary/30 border-y border-border overflow-hidden">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Trusted by GCs, estimators, and subcontractors nationwide
          </p>
        </div>

        <div className="relative">
          {/* Gradient fade overlays */}
          <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-secondary/30 to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-secondary/30 to-transparent z-10 pointer-events-none" />
          
          {/* Scrolling logos container */}
          <div className="flex animate-marquee gap-20 items-center">
            {/* First set of logos */}
            <img src={logoNorthworks} alt="Northworks" className="h-6 flex-shrink-0" />
            <img src={logoWestbuild} alt="Westbuild" className="h-6 flex-shrink-0" />
            <img src={logoMetroworks} alt="Metroworks" className="h-6 flex-shrink-0" />
            <img src={logoPrimesite} alt="Primesite" className="h-6 flex-shrink-0" />
            <img src={logoBluepeak} alt="Bluepeak" className="h-6 flex-shrink-0" />
            
            {/* Duplicate set for seamless loop */}
            <img src={logoNorthworks} alt="Northworks" className="h-6 flex-shrink-0" />
            <img src={logoWestbuild} alt="Westbuild" className="h-6 flex-shrink-0" />
            <img src={logoMetroworks} alt="Metroworks" className="h-6 flex-shrink-0" />
            <img src={logoPrimesite} alt="Primesite" className="h-6 flex-shrink-0" />
            <img src={logoBluepeak} alt="Bluepeak" className="h-6 flex-shrink-0" />
          </div>
        </div>
      </div>
    </section>
  );
};
export default Partners;