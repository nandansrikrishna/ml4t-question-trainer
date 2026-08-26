import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const deploymentUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.VERCEL_PROJECT_PRODUCTION_URL ??
  process.env.VERCEL_URL ??
  'http://localhost:3000';

const metadataBase = new URL(
  deploymentUrl.startsWith('http') ? deploymentUrl : `https://${deploymentUrl}`,
);

export const metadata: Metadata = {
  metadataBase,
  title: 'ML4T Recall — CS 7646 Learning Companion',
  description: 'Learn the concepts behind the ML4T exams through guided practice, explanations, and adaptive review.',
  openGraph: {
    title: 'ML4T Recall',
    description: 'A concept-first learning companion for CS 7646.',
    type: 'website',
    images: [{ url: '/ml4t-learning-logo.png', width: 120, height: 120, alt: 'ML4T Recall learning app logo' }],
  },
  twitter: {
    card: 'summary',
    title: 'ML4T Recall',
    description: 'A concept-first learning companion for CS 7646.',
    images: ['/ml4t-learning-logo.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
