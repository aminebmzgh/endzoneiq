import { connection } from "next/server";
import { webhookHandler } from "@/lib/billing/routes";

const handler = webhookHandler();

export async function POST(req: Request) {
  await connection();
  return handler(req);
}
