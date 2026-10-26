import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LabClient } from "@/components/lab/LabClient";
import { Unlock } from "@/components/lab/Unlock";
import { LAB_COOKIE, tokenGrantsAccess } from "@/lib/lab/access";

export const metadata: Metadata = {
  title: "Scan lab",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const jar = await cookies();
  if (!tokenGrantsAccess(jar.get(LAB_COOKIE)?.value)) {
    return <Unlock />;
  }
  return <LabClient />;
}
