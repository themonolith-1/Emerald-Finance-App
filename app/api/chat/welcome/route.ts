import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runChatWithHuggingFace } from "../../../../lib/ai";
import { buildSystemPrompt } from "../../../../lib/ai/prompt";
import { callOpenAI, type OpenAIMessage } from "../../../../lib/ai/providers/openai";

function buildProviderSetupMessage() {
  return (
    "Hi — I’m Emerald Bot.\n\n" +
    "It looks like this app doesn’t have an AI provider configured yet.\n\n" +
    "To enable chat, add an AI provider in .env.local and restart the dev server:\n\n" +
    "Option A (Hugging Face):\n" +
    "CHAT_PROVIDER=huggingface\n" +
    "HUGGINGFACE_API_KEY=...\n" +
    "HUGGINGFACE_MODEL=mistralai/Mistral-7B-Instruct-v0.3\n\n" +
    "Option B (OpenAI):\n" +
    "CHAT_PROVIDER=openai\n" +
    "OPENAI_API_KEY=...\n" +
    "OPENAI_MODEL=gpt-4o-mini\n\n" +
    "After that, reopen this chat and say hello."
  );
}

function fallbackWelcomeMessage(args: { signedIn: boolean }) {
  const extra = args.signedIn
    ? "You can ask about spending trends, budgets, or recent transactions."
    : "Sign in to connect accounts for personalized insights.";

  return (
    "Hi — I’m Emerald Bot.\n\n" +
    `${extra} ` +
    "What would you like to do today?"
  );
}

function extractOpenAIContent(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  if (!("choices" in data)) return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as unknown;
  if (!first || typeof first !== "object") return "";
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

export async function GET() {
  const provider = (process.env.CHAT_PROVIDER ?? "").toLowerCase();
  const openAiKey = process.env.OPENAI_API_KEY;
  const hfKey = process.env.HUGGINGFACE_API_KEY;

  const chosenProvider = provider || (openAiKey ? "openai" : hfKey ? "huggingface" : "");

  const { userId } = await auth();
  const signedIn = Boolean(userId);

  if (!chosenProvider) {
    return NextResponse.json({
      message: { role: "assistant" as const, content: buildProviderSetupMessage() },
    });
  }

  const welcomeRequest =
    "Write a short, friendly welcome message (2–4 sentences). " +
    "Introduce yourself as Emerald Bot. " +
    (signedIn
      ? "Mention you can help analyze budgets and spending inside the app. "
      : "Mention that signing in and connecting accounts enables personalized insights. ") +
    "End with: 'What would you like to do today?'";

  try {
    if (chosenProvider === "huggingface") {
      if (!hfKey) {
        return NextResponse.json({
          message: { role: "assistant" as const, content: buildProviderSetupMessage() },
        });
      }

      const out = await runChatWithHuggingFace({
        userId: userId ?? null,
        messages: [{ role: "user", content: welcomeRequest }],
      });

      const text = out.ok ? out.text?.trim() : "";
      return NextResponse.json({
        message: {
          role: "assistant" as const,
          content: text || fallbackWelcomeMessage({ signedIn }),
        },
      });
    }

    if (chosenProvider === "openai") {
      if (!openAiKey) {
        return NextResponse.json({
          message: { role: "assistant" as const, content: buildProviderSetupMessage() },
        });
      }

      const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
      const system = buildSystemPrompt({ userName: null });

      const messages: OpenAIMessage[] = [
        { role: "system", content: system },
        { role: "user", content: welcomeRequest },
      ];

      const out = await callOpenAI({ apiKey: openAiKey, model, messages });
      const content = out.ok ? extractOpenAIContent(out.data) : "";

      return NextResponse.json({
        message: {
          role: "assistant" as const,
          content: typeof content === "string" && content.trim() ? content.trim() : fallbackWelcomeMessage({ signedIn }),
        },
      });
    }

    return NextResponse.json({
      message: {
        role: "assistant" as const,
        content:
          buildProviderSetupMessage() +
          `\n\n(Unsupported CHAT_PROVIDER: ${chosenProvider}. Use 'openai' or 'huggingface'.)`,
      },
    });
  } catch {
    return NextResponse.json({
      message: { role: "assistant" as const, content: fallbackWelcomeMessage({ signedIn }) },
    });
  }
}
