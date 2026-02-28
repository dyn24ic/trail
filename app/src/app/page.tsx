import LandingClient from "@/components/landing/LandingClient";
import HeroOverlay from "@/components/landing/HeroOverlay";
import HeroSection from "@/components/landing/HeroSection";
import NavigationBar from "@/components/landing/NavigationBar";
import FeaturesSection from "@/components/landing/FeaturesSection";
import StagesSection from "@/components/landing/StagesSection";
import CtaSection from "@/components/landing/CtaSection";

export default function LandingPage() {
  return (
    <>
      <LandingClient />
      <div className="vignette" />
      <div className="side-fade" />
      <div className="bottom-fade" />

      {/* Hero Content Layer */}
      <div className="hero-layer">
        <NavigationBar />
        <HeroSection />
      </div>

      <HeroOverlay />

      <div className="page-content">
        <FeaturesSection />
        <StagesSection />
        <CtaSection />
      </div>
    </>
  );
}
