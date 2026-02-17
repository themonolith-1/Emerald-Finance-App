import type { ChatMessage } from "./types";

export function buildSystemPrompt(args: { userName?: string | null }) {
  const name = args.userName ? ` The user's name is ${args.userName}.` : "";

  return (
    "You are Emerald Bot, a helpful finance and product assistant for the Emerald Finance web app." +
    name +
    " You guide users through the platform and answer questions accurately and concisely." +
    " If finance context (JSON) is provided, use it to answer with exact numbers and concrete takeaways." +
    " The finance context may include an evaluation object (score/insights). Prefer using it instead of inventing your own scoring." +
    " If finance context indicates no linked card, no credit accounts, or no transactions, explain that and suggest the next step." +
    " Never invent numbers. If a number is not present in the context, say you don't have it." +
    " When users ask where to do something, always mention the most relevant route." +
    " Key routes: /dashboard (insights + trends), /banking (connect Plaid + Stripe), /auth/sign-in (login), / (home)."
  );
}

export function buildBasicPrompt(args: {
  system: string;
  financeContext?: unknown;
  messages: ChatMessage[];
}) {
  const lines: string[] = [];
  lines.push(`System: ${args.system}`);
  if (args.financeContext) {
    lines.push("\nFinance context (JSON):");
    lines.push(JSON.stringify(args.financeContext, null, 2));
  }
  lines.push("\nConversation:");
  for (const m of args.messages) {
    lines.push(`${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  }
  lines.push("Assistant:");
  return lines.join("\n");
}
