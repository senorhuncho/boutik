import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Unlock } from "@/components/lab/Unlock";
import { ScanFlow } from "@/components/shop/ScanFlow";
import { LAB_COOKIE, tokenGrantsAccess } from "@/lib/lab/access";

export const metadata: Metadata = {
  title: "Open your shop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** The trader's page. During the pilot it opens with the invite code. */
export default async function ScanPage() {
  const jar = await cookies();
  if (!tokenGrantsAccess(jar.get(LAB_COOKIE)?.value)) return <Unlock title="Open your shop" />;
  return <ScanFlow />;
}
