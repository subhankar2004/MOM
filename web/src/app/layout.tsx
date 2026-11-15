import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Header } from "@/components/header";
import { ConfigWarning, Spinner } from "@/components/ui";
import { AuthProvider } from "@/lib/auth";
import { CartProvider } from "@/lib/cart";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MOM — Order from campus food stalls",
  description: "Skip the queue. Order from food stalls around VSSUT, pay online or at the counter, and pick up with your token.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#ea580c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <AuthProvider>
          <CartProvider>
            <ConfigWarning />
            <Header />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
              {/* Client pages read URL params/search params; Cache Components needs a boundary. */}
              <Suspense fallback={<Spinner />}>{children}</Suspense>
            </main>
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
