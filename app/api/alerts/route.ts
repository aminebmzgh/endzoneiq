import { connection } from "next/server";
import { alertsHandlers } from "@/lib/notify/routes";

const h = alertsHandlers();

export async function GET(req: Request) {
  await connection();
  return h.GET(req);
}

export async function PUT(req: Request) {
  await connection();
  return h.PUT(req);
}
