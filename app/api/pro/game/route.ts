import { connection } from "next/server";
import { proGameHandler } from "@/lib/pro/routes";

const handler = proGameHandler();

export async function GET(req: Request) {
  await connection();
  return handler(req);
}
