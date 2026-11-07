import { connection } from "next/server";
import { cronWeeklyEmail } from "@/lib/cron/handlers";

export async function POST(req: Request) {
  await connection();
  return cronWeeklyEmail(req);
}
