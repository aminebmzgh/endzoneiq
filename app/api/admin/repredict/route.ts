import { connection } from "next/server";
import { adminHandlers } from "@/lib/admin/data";

const h = adminHandlers();

export async function POST(req: Request) {
  await connection();
  return h.repredict(req);
}
