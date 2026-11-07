import { connection } from "next/server";
import { cronNotifications } from "@/lib/cron/handlers";

export async function POST(req: Request) {
  await connection();
  return cronNotifications(req);
}
