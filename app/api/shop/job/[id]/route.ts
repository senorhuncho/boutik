import { NextResponse } from "next/server";
import { LAB_COOKIE, LAB_COOKIE_MAX_AGE, labToken } from "@/lib/lab/access";
import { shopError } from "@/lib/shop/http";
import { NotFound } from "@/lib/shop/service";
import { openJob } from "@/lib/whatsapp/handle";

export const runtime = "nodejs";

/**
 * A scan job from WhatsApp, opened on the trader's phone: the shop, its
 * secret and the video. Owning the WhatsApp number is the invitation, so the
 * reply also opens the scan API for this phone.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound("No such job.");
    const job = await openJob(id);
    if (!job) throw new NotFound("This link has expired or the video is still arriving. Try again in a moment.");
    const response = NextResponse.json({
      shop: { slug: job.shop.slug, name: job.shop.name, whatsapp: job.shop.whatsapp, language: job.shop.language },
      manageToken: job.shop.manage_token,
      videoUrl: job.videoUrl,
      status: job.status,
    });
    const token = labToken();
    if (token) {
      response.cookies.set(LAB_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: LAB_COOKIE_MAX_AGE });
    }
    return response;
  } catch (error) {
    return shopError(error);
  }
}
