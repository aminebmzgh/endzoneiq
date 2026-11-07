import { connection } from "next/server";
import { meHandler } from "@/lib/pro/routes";

const handler = meHandler();

export async function GET(req: Request) {
  await connection();
  return handler(req);
}
