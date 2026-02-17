import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getOrCreateChatSession, getChatHistory } from "../../../../lib/ai";

const BodySchema = z.object({
  sessionId: z.string().optional(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sessionId } = await getOrCreateChatSession({ userId, sessionId: parsed.data.sessionId });
  const messages = await getChatHistory({ userId, sessionId, limit: 60 });

  return NextResponse.json({ sessionId, messages });
}
