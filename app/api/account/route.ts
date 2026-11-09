import { connection } from "next/server";
import { preferencesHandler } from "@/lib/account";
import { deleteHandler } from "@/lib/account-data";

const patch = preferencesHandler();
const del = deleteHandler();

export async function PATCH(req: Request) {
  await connection();
  return patch(req);
}

export async function DELETE(req: Request) {
  await connection();
  return del(req);
}
