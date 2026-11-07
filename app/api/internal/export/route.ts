import { connection } from "next/server";
import { exportState } from "@/lib/internal/handlers";

export async function GET(req: Request) {
  await connection(); // request-time only, never prerendered
  return exportState(req);
}
