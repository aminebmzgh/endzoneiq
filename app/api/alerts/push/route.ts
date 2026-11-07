import { connection } from "next/server";
import { pushHandlers } from "@/lib/notify/routes";

const h = pushHandlers();

export async function POST(req: Request) {
  await connection();
  return h.POST(req);
}

export async function DELETE(req: Request) {
  await connection();
  return h.DELETE(req);
}

export async function PUT(req: Request) {
  await connection();
  return h.PUT(req);
}
