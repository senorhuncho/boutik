import type { Metadata } from "next";
import { LabClient } from "@/components/lab/LabClient";

export const metadata: Metadata = {
  title: "Scan lab",
  robots: { index: false, follow: false },
};

export default function LabPage() {
  return <LabClient />;
}
