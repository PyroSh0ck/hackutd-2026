import type { Metadata } from "next";
import { ScamperShell } from "@/features/scamper/shell";

export const metadata: Metadata = {
  title: "Cyber Sleuth: practice spotting customer scams",
  description: "A consent-based messaging simulation for practicing how to assess suspicious requests.",
};

export default function ScamperLayout({ children }: LayoutProps<"/scamper">) {
  return <ScamperShell>{children}</ScamperShell>;
}
