import { connection } from "next/server";
import { authConfigured, getAuth } from "@/lib/auth";

/** Better Auth's endpoints (magic link, Google OAuth, session, sign-out). */
async function handle(req: Request): Promise<Response> {
  await connection();
  if (!authConfigured()) {
    return Response.json({ error: "sign-in is not configured" }, { status: 503 });
  }
  return getAuth().handler(req);
}

export const GET = handle;
export const POST = handle;
