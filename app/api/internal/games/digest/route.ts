import { connection } from "next/server";
import { gamesDigestHandler } from "@/lib/internal/handlers";

export async function GET(req: Request) {
  await connection(); // request-time only, never prerendered
  return gamesDigestHandler(req);
}
