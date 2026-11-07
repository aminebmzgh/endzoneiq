import { connection } from "next/server";
import { cronIntegrityCheck } from "@/lib/cron/handlers";

export async function POST(req: Request) {
  await connection();
  return cronIntegrityCheck(req);
}
