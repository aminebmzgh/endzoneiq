import { connection } from "next/server";
import { exportHandler } from "@/lib/account-data";

const handler = exportHandler();

export async function GET(req: Request) {
  await connection();
  return handler(req);
}
