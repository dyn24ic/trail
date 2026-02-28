import type { Metadata } from 'next';
import { Cinzel, Exo_2 } from 'next/font/google';
import './globals.css';

const cinzel = Cinzel({
  variable: '--font-cinzel',
  subsets: ['latin'],
  weight: ['400', '700', '900'],
});

const exo2 = Exo_2({
  variable: '--font-exo2',
  subsets: ['latin'],
  weight: ['200', '300', '400', '600', '700'],
  style: ['normal', 'italic'],
});

export const metadata: Metadata = {
  title: 'trAIl — Trail Guardian · AI Search & Rescue',
  description: 'AI-powered detection, drone response, and responder routing for backcountry trail networks.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@300;400;500;600;700&family=Barlow:wght@300;400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${cinzel.variable} ${exo2.variable}`}
        style={{ fontFamily: "'Exo 2', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
