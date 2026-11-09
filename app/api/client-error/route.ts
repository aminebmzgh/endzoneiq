import { connection } from "next/server";
import { clientErrorHandler } from "@/lib/observability/client-errors";

const handler = clientErrorHandler();

export async function POST(req: Request) {
  await connection();
  return handler(req);
}
