import logoNorthworks from "@/assets/logo-northworks.png";
import logoWestbuild from "@/assets/logo-westbuild.png";
import logoMetroworks from "@/assets/logo-metroworks.png";
import logoPrimesite from "@/assets/logo-primesite.png";
import logoBluepeak from "@/assets/logo-bluepeak.png";

const Partners = () => {
  return <section className="py-16 bg-secondary/30 border-y border-border">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Trusted by GCs, estimators, and subcontractors nationwide
          </p>
        </div>

        <div className="flex justify-center items-center gap-12">
          <img src={logoNorthworks} alt="Northworks" className="h-6 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
          <img src={logoWestbuild} alt="Westbuild" className="h-6 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
          <img src={logoMetroworks} alt="Metroworks" className="h-6 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
          <img src={logoPrimesite} alt="Primesite" className="h-6 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
          <img src={logoBluepeak} alt="Bluepeak" className="h-6 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
        </div>
      </div>
    </section>;
};
export default Partners;