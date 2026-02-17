import { clerkClient } from "@clerk/nextjs/server";

export async function getUserDisplayName(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    return u.fullName || u.firstName || u.username || null;
  } catch {
    return null;
  }
}
