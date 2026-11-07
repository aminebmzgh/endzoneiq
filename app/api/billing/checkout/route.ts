import { connection } from "next/server";
import { checkoutHandler } from "@/lib/billing/routes";

const handler = checkoutHandler();

export async function POST(req: Request) {
  await connection();
  return handler(req);
}
