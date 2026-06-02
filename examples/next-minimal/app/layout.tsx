import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "auto-geo · built by Shadow",
    template: "%s | auto-geo",
  },
  description:
    "Reference Next.js app integrating auto-geo — the publishing engine for GEO resource pages, built by Shadow.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}
