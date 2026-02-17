import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../lib/server/prisma";
import { z } from "zod";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await prisma.bankConnection.findMany({
    where: { userId },
    include: { accounts: true, cursor: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ connections });
}

const DeleteSchema = z.object({
  connectionId: z.string().min(1),
});

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Cascades remove accounts/tx/cursor
  await prisma.bankConnection.deleteMany({
    where: { id: body.data.connectionId, userId },
  });

  return NextResponse.json({ ok: true });
}
