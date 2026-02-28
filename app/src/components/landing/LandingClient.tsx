'use client';

import dynamic from 'next/dynamic';

const MountainScene = dynamic(() => import('@/components/three/MountainScene'), {
  ssr: false,
  loading: () => <div className="terrain-loading" />,
});

export default function LandingClient() {
  return <MountainScene />;
}
