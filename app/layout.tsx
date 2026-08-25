import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_ORIGIN ?? 'http://localhost:3000'),
  title: 'ML4T Recall — CS 7646 Question Pool Trainer',
  description: 'Practice the authoritative ML4T exam question pool with multi-select review and spaced repetition.',
  openGraph: {
    title: 'ML4T Recall',
    description: 'CS 7646 Question Pool Trainer',
    type: 'website',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'ML4T Recall — CS 7646 Question Pool Trainer' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ML4T Recall',
    description: 'CS 7646 Question Pool Trainer',
    images: ['/og.png'],
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
      </body>
    </html>
  );
}
