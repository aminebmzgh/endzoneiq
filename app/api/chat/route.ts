import { connection } from "next/server";
import { chatGetHandler, chatPostHandler } from "@/lib/chat/route";

const post = chatPostHandler();
const get = chatGetHandler();

export async function POST(req: Request) {
  await connection();
  return post(req);
}

export async function GET(req: Request) {
  await connection();
  return get(req);
}
