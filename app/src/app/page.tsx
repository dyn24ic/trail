import LandingClient from '@/components/landing/LandingClient';
import HeroOverlay from '@/components/landing/HeroOverlay';
import FeaturesSection from '@/components/landing/FeaturesSection';
import StagesSection from '@/components/landing/StagesSection';
import CtaSection from '@/components/landing/CtaSection';

export default function LandingPage() {
  return (
    <>
      <LandingClient />
      <div className="vignette" />
      <div className="side-fade" />
      <div className="bottom-fade" />

      <HeroOverlay />

      <div className="page-content">
        <FeaturesSection />
        <StagesSection />
        <CtaSection />
      </div>
    </>
  );
}
