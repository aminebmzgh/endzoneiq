import { connection } from "next/server";
import { portalHandler } from "@/lib/billing/routes";

const handler = portalHandler();

export async function POST(req: Request) {
  await connection();
  return handler(req);
}
