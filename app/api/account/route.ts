import { connection } from "next/server";
import { preferencesHandler } from "@/lib/account";

const handler = preferencesHandler();

export async function PATCH(req: Request) {
  await connection();
  return handler(req);
}
