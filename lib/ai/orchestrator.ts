import type { ChatMessage } from "./types";
import { getUserDisplayName } from "./user";
import { buildBasicPrompt, buildSystemPrompt } from "./prompt";
import { callHuggingFaceTextGeneration } from "./providers/huggingface";
import { TimeframeSchema, getFinanceSnapshotForUser, getRecentTransactionsForUser, getSpendingSummaryForUser } from "./finance";
import { buildFinanceEvaluation } from "./evaluations";
import type { FinancePeriod } from "../finance";
import { z } from "zod";

function inferPeriodFromText(text: string): FinancePeriod {
  const t = text.toLowerCase();
  if (t.includes("this week") || t.includes("past week") || t.includes("last 7") || t.includes("7 days")) return "1W";
  if (t.includes("3 months") || t.includes("past 3") || t.includes("90 days") || t.includes("quarter")) return "3M";
  if (t.includes("this year") || t.includes("past year") || t.includes("12 months") || t.includes("365")) return "1Y";
  if (t.includes("all time") || t.includes("lifetime")) return "ALL";
  return "1M";
}

function inferTimeframeFromText(text: string): z.infer<typeof TimeframeSchema> {
  const t = text.toLowerCase();
  if (t.includes("this month")) return "THIS_MONTH";
  if (t.includes("last month") || t.includes("previous month")) return "LAST_MONTH";
  if (t.includes("past 7") || t.includes("last 7") || t.includes("7 days") || t.includes("this week")) return "PAST_7_DAYS";
  if (t.includes("past 90") || t.includes("90 days") || t.includes("3 months") || t.includes("quarter")) return "PAST_90_DAYS";
  if (t.includes("all time") || t.includes("lifetime")) return "ALL_TIME";
  return "PAST_30_DAYS";
}

function looksLikeFinanceQuestion(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("spend") ||
    t.includes("spent") ||
    t.includes("transaction") ||
    t.includes("balance") ||
    t.includes("income") ||
    t.includes("savings") ||
    t.includes("bill") ||
    t.includes("subscription") ||
    t.includes("budget")
  );
}

export async function runChatWithHuggingFace(args: {
  userId: string | null;
  messages: ChatMessage[];
}) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    return {
      ok: false as const,
      error: "Missing HUGGINGFACE_API_KEY in .env.local.",
    };
  }

  const model = process.env.HUGGINGFACE_MODEL || "mistralai/Mistral-7B-Instruct-v0.3";
  const lastUser = [...args.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const userName = args.userId ? await getUserDisplayName(args.userId) : null;
  const system = buildSystemPrompt({ userName });

  let financeContext: unknown = undefined;
  if (args.userId && looksLikeFinanceQuestion(lastUser)) {
    const period = inferPeriodFromText(lastUser);
    const timeframe = inferTimeframeFromText(lastUser);

    try {
      const [snapshotRes, recentTx, spending] = await Promise.all([
        getFinanceSnapshotForUser(args.userId, period),
        getRecentTransactionsForUser(args.userId, { limit: 12, timeframe }),
        getSpendingSummaryForUser(args.userId, timeframe),
      ]);

      const evaluation = buildFinanceEvaluation({ snapshot: snapshotRes.snapshot, spendingSummary: spending });

      financeContext = {
        period,
        timeframe,
        snapshot: snapshotRes.snapshot,
        recentTransactions: recentTx,
        spendingSummary: spending,
        evaluation,
      };
    } catch {
      financeContext = { error: "Failed to load finance context" };
    }
  }

  const prompt = buildBasicPrompt({ system, financeContext, messages: args.messages });
  const out = await callHuggingFaceTextGeneration({ apiKey, model, prompt });
  if (!out.ok) {
    return { ok: false as const, error: `Hugging Face error (${out.status})`, details: out.text };
  }

  return { ok: true as const, text: out.text };
}
