import { connection } from "next/server";
import { adminHandlers } from "@/lib/admin/data";

const h = adminHandlers();

export async function GET(req: Request) {
  await connection();
  return h.runs(req);
}
