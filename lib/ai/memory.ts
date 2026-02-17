import { prisma } from "../server/prisma";
import type { ChatMessage } from "./types";

export async function getOrCreateChatSession(args: { userId: string; sessionId?: string | null }) {
  // Clerk is the source of truth for identity; Prisma `User` is an app-local mirror.
  // Ensure the FK target exists before creating a session.
  await prisma.user.upsert({
    where: { id: args.userId },
    update: {},
    create: { id: args.userId },
    select: { id: true },
  });

  if (args.sessionId) {
    const existing = await prisma.chatSession.findFirst({
      where: { id: args.sessionId, userId: args.userId },
      select: { id: true },
    });
    if (existing) return { sessionId: existing.id };
  }

  const created = await prisma.chatSession.create({
    data: {
      userId: args.userId,
    },
    select: { id: true },
  });
  return { sessionId: created.id };
}

export async function getChatHistory(args: { userId: string; sessionId: string; limit?: number }): Promise<ChatMessage[]> {
  const session = await prisma.chatSession.findFirst({
    where: { id: args.sessionId, userId: args.userId },
    select: { id: true },
  });
  if (!session) return [];

  const rows: Array<{ role: string; content: string }> = await prisma.chatMessage.findMany({
    where: { sessionId: args.sessionId },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(args.limit ?? 40, 1), 200),
    select: { role: true, content: true },
  });

  return rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({ role: row.role as "user" | "assistant", content: row.content }));
}

export async function appendChatMessages(args: { userId: string; sessionId: string; messages: ChatMessage[] }) {
  const session = await prisma.chatSession.findFirst({
    where: { id: args.sessionId, userId: args.userId },
    select: { id: true },
  });
  if (!session) return;

  if (args.messages.length === 0) return;

  await prisma.chatMessage.createMany({
    data: args.messages.map((m) => ({
      sessionId: args.sessionId,
      role: m.role,
      content: m.content,
    })),
  });
}
