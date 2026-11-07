import { connection } from "next/server";
import { cronCleanup } from "@/lib/cron/handlers";

export async function POST(req: Request) {
  await connection();
  return cronCleanup(req);
}
