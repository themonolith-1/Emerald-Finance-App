import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "../../../lib/server/prisma";
import { buildDashboardSnapshotFromTransactions, buildZeroDashboardSnapshot } from "../../../lib/finance/from-transactions";
import type { FinancePeriod } from "../../../lib/finance";
import { appendChatMessages, getChatHistory, getOrCreateChatSession, runChatWithHuggingFace } from "../../../lib/ai";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1),
  sessionId: z.string().optional(),
});

const PeriodSchema = z.enum(["1W", "1M", "3M", "1Y", "ALL"]);

const TimeframeSchema = z.enum([
  "PAST_7_DAYS",
  "PAST_30_DAYS",
  "PAST_90_DAYS",
  "THIS_MONTH",
  "LAST_MONTH",
  "ALL_TIME",
]);

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

async function hasStripeCardLinked(userId: string): Promise<boolean> {
  return (
    (await prisma.stripePaymentMethod.count({
      where: { userId },
    })) > 0
  );
}

async function getCreditAccountIdsForUser(userId: string): Promise<string[]> {
  const rows = await prisma.bankAccount.findMany({
    where: {
      userId,
      OR: [
        { type: { in: ["credit", "Credit", "CREDIT"] } },
        { subtype: { in: ["credit", "Credit", "CREDIT"] } },
        { subtype: { contains: "credit" } },
        { subtype: { contains: "Credit" } },
        { subtype: { contains: "card" } },
        { subtype: { contains: "Card" } },
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function getFinanceSnapshotForUser(userId: string, period: FinancePeriod) {
  if (!(await hasStripeCardLinked(userId))) {
    return { snapshot: buildZeroDashboardSnapshot(period) } as const;
  }

  const creditAccountIds = await getCreditAccountIdsForUser(userId);
  if (creditAccountIds.length === 0) {
    return { snapshot: buildZeroDashboardSnapshot(period) } as const;
  }

  const accounts = await prisma.bankAccount.findMany({
    where: { userId, id: { in: creditAccountIds } },
    select: {
      currentBalance: true,
      availableBalance: true,
      currencyCode: true,
    },
  });

  const now = new Date();
  const maxDays = period === "ALL" ? 730 : period === "1Y" ? 365 : period === "3M" ? 120 : 90;
  const from = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);

  const transactions = await prisma.bankTransaction.findMany({
    where: {
      userId,
      accountId: { in: creditAccountIds },
      date: { gte: from },
    },
    orderBy: { date: "desc" },
    take: 5000,
    select: {
      id: true,
      date: true,
      name: true,
      merchantName: true,
      amount: true,
      category: true,
    },
  });

  const hasData = accounts.length > 0 || transactions.length > 0;
  if (!hasData) {
    return { snapshot: buildZeroDashboardSnapshot(period) } as const;
  }

  const snapshot = buildDashboardSnapshotFromTransactions({
    period,
    accounts,
    transactions: transactions.map((t: (typeof transactions)[number]) => ({
      id: t.id,
      date: t.date,
      name: t.name,
      meta: t.merchantName,
      amount: t.amount,
      category: t.category,
    })),
    now,
  });

  return { snapshot } as const;
}

function getDateRangeForTimeframe(timeframe: z.infer<typeof TimeframeSchema>) {
  const now = new Date();

  if (timeframe === "ALL_TIME") {
    return { from: null as Date | null, to: now };
  }

  if (timeframe === "THIS_MONTH") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to: now };
  }

  if (timeframe === "LAST_MONTH") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { from, to };
  }

  const days = timeframe === "PAST_7_DAYS" ? 7 : timeframe === "PAST_90_DAYS" ? 90 : 30;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to: now };
}

async function getRecentTransactionsForUser(userId: string, params: { limit: number; timeframe: z.infer<typeof TimeframeSchema> }) {
  if (!(await hasStripeCardLinked(userId))) {
    return { timeframe: params.timeframe, count: 0, transactions: [] };
  }

  const creditAccountIds = await getCreditAccountIdsForUser(userId);
  if (creditAccountIds.length === 0) {
    return { timeframe: params.timeframe, count: 0, transactions: [] };
  }

  const { from, to } = getDateRangeForTimeframe(params.timeframe);

  const transactions = await prisma.bankTransaction.findMany({
    where: {
      userId,
      accountId: { in: creditAccountIds },
      ...(from
        ? {
            date: {
              gte: from,
              lte: to,
            },
          }
        : {}),
    },
    orderBy: { date: "desc" },
    take: Math.min(Math.max(params.limit, 1), 100),
    select: {
      id: true,
      date: true,
      name: true,
      merchantName: true,
      amount: true,
      category: true,
    },
  });

  return {
    timeframe: params.timeframe,
    count: transactions.length,
    transactions: transactions.map((t) => ({
      id: t.id,
      date: t.date,
      name: t.name,
      merchantName: t.merchantName,
      amount: t.amount,
      category: t.category,
    })),
  };
}

function buildSpendingSummary(transactions: Array<{ amount: number; category: string | null }>) {
  let income = 0;
  let spend = 0;

  const spendByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount >= 0) {
      income += t.amount;
      continue;
    }
    const spendValue = -t.amount;
    spend += spendValue;

    const category = (t.category ?? "Uncategorized").trim() || "Uncategorized";
    spendByCategory.set(category, (spendByCategory.get(category) ?? 0) + spendValue);
  }

  const topCategories = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([category, amount]) => ({ category, amount }));

  const net = income - spend;
  return {
    income,
    spend,
    net,
    topCategories,
  };
}

async function getSpendingSummaryForUser(userId: string, timeframe: z.infer<typeof TimeframeSchema>) {
  if (!(await hasStripeCardLinked(userId))) {
    return {
      timeframe,
      income: 0,
      spend: 0,
      net: 0,
      topCategories: [],
    };
  }

  const creditAccountIds = await getCreditAccountIdsForUser(userId);
  if (creditAccountIds.length === 0) {
    return {
      timeframe,
      income: 0,
      spend: 0,
      net: 0,
      topCategories: [],
    };
  }

  const { from, to } = getDateRangeForTimeframe(timeframe);
  const transactions = await prisma.bankTransaction.findMany({
    where: {
      userId,
      accountId: { in: creditAccountIds },
      ...(from
        ? {
            date: {
              gte: from,
              lte: to,
            },
          }
        : {}),
    },
    select: {
      amount: true,
      category: true,
    },
  });

  return {
    timeframe,
    ...buildSpendingSummary(transactions),
  };
}

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAIChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    };
  }>;
};

async function callOpenAI(params: {
  apiKey: string;
  model: string;
  messages: OpenAIMessage[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }>;
}) {
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.4,
      messages: params.messages,
      tools: params.tools,
      tool_choice: params.tools?.length ? "auto" : undefined,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return {
      ok: false as const,
      status: upstream.status,
      text,
    };
  }

  const data = (await upstream.json().catch(() => null)) as OpenAIChatCompletion | null;
  return {
    ok: true as const,
    data,
  };
}

async function callHuggingFaceTextGeneration(params: { apiKey: string; model: string; prompt: string }) {
  const upstream = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(params.model)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      inputs: params.prompt,
      parameters: {
        max_new_tokens: 500,
        temperature: 0.3,
        return_full_text: false,
      },
      options: {
        wait_for_model: true,
      },
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return { ok: false as const, status: upstream.status, text };
  }

  const data = (await upstream.json().catch(() => null)) as
    | Array<{ generated_text?: unknown }>
    | { generated_text?: unknown }
    | null;
  const generated =
    (Array.isArray(data) && typeof data[0]?.generated_text === "string" && data[0].generated_text) ||
    (!Array.isArray(data) && typeof data?.generated_text === "string" && data.generated_text) ||
    "";

  return { ok: true as const, text: generated.trim() };
}

function buildBasicPrompt(args: {
  system: string;
  financeContext?: unknown;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
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

function buildProviderSetupMessage() {
  return (
    "Hi — I’m Emerald Bot.\n\n" +
    "This app doesn’t have an AI provider configured yet.\n\n" +
    "To enable chat, add an AI provider in .env.local and restart the dev server:\n\n" +
    "Option A (Hugging Face):\n" +
    "CHAT_PROVIDER=huggingface\n" +
    "HUGGINGFACE_API_KEY=...\n" +
    "HUGGINGFACE_MODEL=mistralai/Mistral-7B-Instruct-v0.3\n\n" +
    "Option B (OpenAI):\n" +
    "CHAT_PROVIDER=openai\n" +
    "OPENAI_API_KEY=...\n" +
    "OPENAI_MODEL=gpt-4o-mini"
  );
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const provider = (process.env.CHAT_PROVIDER ?? "").toLowerCase();
  const openAiKey = process.env.OPENAI_API_KEY;
  const hfKey = process.env.HUGGINGFACE_API_KEY;

  const chosenProvider = provider || (openAiKey ? "openai" : hfKey ? "huggingface" : "");
  if (!chosenProvider) {
    return NextResponse.json({
      message: { role: "assistant" as const, content: buildProviderSetupMessage() },
    });
  }

  const { userId } = await auth();

  // If signed in, persist/restore chat history via DB.
  const rawIncoming = parsed.data.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const lastUserText = [...rawIncoming].reverse().find((m) => m.role === "user")?.content ?? "";

  let sessionId: string | undefined = parsed.data.sessionId;
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (userId) {
    const created = await getOrCreateChatSession({ userId, sessionId });
    sessionId = created.sessionId;
    history = await getChatHistory({ userId, sessionId, limit: 60 });
  }

  const mergedForModel = (() => {
    const combined = [...history];
    if (lastUserText) {
      const last = combined[combined.length - 1];
      if (!(last && last.role === "user" && last.content === lastUserText)) {
        combined.push({ role: "user", content: lastUserText });
      }
    }
    // Keep prompts bounded
    return combined.slice(-30);
  })();

  const baseSystemPrompt =
    "You are Emerald Bot, a helpful finance and product assistant for the Emerald Finance Tracker web app. " +
    "Be concise, accurate, and ask clarifying questions when needed. " +
    "If you are provided finance context, use it to answer with exact numbers. " +
    "If the finance context indicates there is no linked card or no transactions, explain that and suggest linking a card/bank.";

  // Hugging Face path: inject finance context (no OpenAI-style function calling here)
  if (chosenProvider === "huggingface") {
    const out = await runChatWithHuggingFace({
      userId: userId ?? null,
      messages: userId ? mergedForModel : rawIncoming.slice(-20),
    });

    if (!out.ok) {
      if ((out.error || "").toLowerCase().includes("missing huggingface_api_key")) {
        return NextResponse.json({
          message: { role: "assistant" as const, content: buildProviderSetupMessage() },
        });
      }

      const details = (() => {
        const raw = (out as { details?: unknown }).details;
        if (typeof raw === "string") return raw;
        if (raw == null) return "";
        try {
          return String(raw);
        } catch {
          return "";
        }
      })();

      return NextResponse.json(
        { error: out.error, details: details.slice(0, 2000) },
        { status: 502 }
      );
    }

    const assistantText = out.text?.trim() || "Sorry — I couldn't generate a response.";

    if (userId && sessionId && lastUserText) {
      await appendChatMessages({
        userId,
        sessionId,
        messages: [
          { role: "user", content: lastUserText },
          { role: "assistant", content: assistantText },
        ],
      });
    }

    return NextResponse.json({
      sessionId,
      message: {
        role: "assistant" as const,
        content: assistantText,
      },
    });
  }

  if (chosenProvider !== "openai") {
    return NextResponse.json({
      message: {
        role: "assistant" as const,
        content:
          buildProviderSetupMessage() +
          `\n\n(Unsupported CHAT_PROVIDER: ${chosenProvider}. Use 'openai' or 'huggingface'.)`,
      },
    });
  }

  const apiKey = openAiKey;
  if (!apiKey) {
    return NextResponse.json({
      message: { role: "assistant" as const, content: buildProviderSetupMessage() },
    });
  }

  const systemPrompt =
    baseSystemPrompt +
    " If the user is not signed in, do not claim you can access their personal financial data. " +
    "If asked for personal financial metrics and the user is signed out, instruct them to sign in and connect accounts." +
    "When the user asks for recent transactions, prefer using the get_recent_transactions tool. " +
    "When the user asks to compare spending between timeframes (e.g., this month vs last month), use get_spending_summary with compareTo.";

  const safetyContext = userId
    ? `User is signed in (userId=${userId}). You may explain app features and how to navigate the product. ` +
      "You do NOT have direct access to their bank transactions unless explicitly provided." 
    : "User is signed out. Provide general guidance only.";

  const trimmed = (userId ? mergedForModel : rawIncoming).slice(-20);

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const baseMessages: OpenAIMessage[] = [
    { role: "system", content: `${systemPrompt}\n\n${safetyContext}` },
    ...trimmed.map((m) => ({ role: m.role, content: m.content } as OpenAIMessage)),
  ];

  const tools = userId
    ? [
        {
          type: "function" as const,
          function: {
            name: "get_finance_snapshot",
            description:
              "Get the user's finance dashboard snapshot for a given period (includes KPIs and recent transactions). Only use when the user asks about their spending, balances, trends, or recent transactions.",
            parameters: {
              type: "object",
              properties: {
                period: {
                  type: "string",
                  enum: ["1W", "1M", "3M", "1Y", "ALL"],
                  description: "Time period for the snapshot. Use 1M for 'this month' unless user specifies otherwise.",
                },
              },
              required: ["period"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "get_recent_transactions",
            description:
              "Fetch a list of the user's most recent transactions for a timeframe. Use this when the user asks 'what are my recent transactions', 'show me last month's transactions', or similar.",
            parameters: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description: "How many transactions to return (1-100).",
                  default: 15,
                },
                timeframe: {
                  type: "string",
                  enum: ["PAST_7_DAYS", "PAST_30_DAYS", "PAST_90_DAYS", "THIS_MONTH", "LAST_MONTH", "ALL_TIME"],
                  description:
                    "Time window to query. Use THIS_MONTH for 'this month', LAST_MONTH for 'last month', PAST_7_DAYS for 'this week'.",
                  default: "PAST_30_DAYS",
                },
              },
              required: ["timeframe"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "get_spending_summary",
            description:
              "Summarize income, spending, net, and top spending categories for a timeframe. Use compareTo for comparisons like this month vs last month.",
            parameters: {
              type: "object",
              properties: {
                timeframe: {
                  type: "string",
                  enum: ["PAST_7_DAYS", "PAST_30_DAYS", "PAST_90_DAYS", "THIS_MONTH", "LAST_MONTH", "ALL_TIME"],
                  description: "Time window to summarize.",
                  default: "THIS_MONTH",
                },
                compareTo: {
                  type: "string",
                  enum: ["PAST_7_DAYS", "PAST_30_DAYS", "PAST_90_DAYS", "THIS_MONTH", "LAST_MONTH", "ALL_TIME"],
                  description: "Optional: another timeframe to compare against.",
                },
              },
              required: ["timeframe"],
              additionalProperties: false,
            },
          },
        },
      ]
    : undefined;

  const first = await callOpenAI({ apiKey, model, messages: baseMessages, tools });
  if (!first.ok) {
    return NextResponse.json(
      { error: "Upstream AI provider error", details: first.text.slice(0, 2000) },
      { status: 502 }
    );
  }

  const firstMsg = first.data?.choices?.[0]?.message;
  const toolCalls = (firstMsg?.tool_calls ?? []) as Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;

  if (userId && toolCalls.length > 0) {
    const nextMessages: OpenAIMessage[] = [
      ...baseMessages,
      {
        role: "assistant",
        content: firstMsg?.content ?? null,
        tool_calls: toolCalls,
      },
    ];

    for (const call of toolCalls) {
      if (call.type !== "function") continue;

      if (call.function.name === "get_finance_snapshot") {
        const argsJson = (() => {
          try {
            return JSON.parse(call.function.arguments || "{}");
          } catch {
            return {};
          }
        })();

        const parsedArgs = z
          .object({ period: PeriodSchema.default("1M") })
          .safeParse(argsJson);

        const period = (parsedArgs.success ? parsedArgs.data.period : "1M") as FinancePeriod;

        const result = await getFinanceSnapshotForUser(userId, period);
        nextMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } else if (call.function.name === "get_recent_transactions") {
        const argsJson = (() => {
          try {
            return JSON.parse(call.function.arguments || "{}");
          } catch {
            return {};
          }
        })();

        const parsedArgs = z
          .object({
            limit: z.number().int().min(1).max(100).default(15),
            timeframe: TimeframeSchema.default("PAST_30_DAYS"),
          })
          .safeParse(argsJson);

        const limit = parsedArgs.success ? parsedArgs.data.limit : 15;
        const timeframe = parsedArgs.success ? parsedArgs.data.timeframe : "PAST_30_DAYS";
        const result = await getRecentTransactionsForUser(userId, { limit, timeframe });

        nextMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } else if (call.function.name === "get_spending_summary") {
        const argsJson = (() => {
          try {
            return JSON.parse(call.function.arguments || "{}");
          } catch {
            return {};
          }
        })();

        const parsedArgs = z
          .object({
            timeframe: TimeframeSchema.default("THIS_MONTH"),
            compareTo: TimeframeSchema.optional(),
          })
          .safeParse(argsJson);

        const timeframe = parsedArgs.success ? parsedArgs.data.timeframe : "THIS_MONTH";
        const compareTo = parsedArgs.success ? parsedArgs.data.compareTo : undefined;

        const primary = await getSpendingSummaryForUser(userId, timeframe);
        if (!compareTo) {
          nextMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(primary),
          });
        } else {
          const baseline = await getSpendingSummaryForUser(userId, compareTo);
          const spendDelta = primary.spend - baseline.spend;
          const spendDeltaPct = baseline.spend === 0 ? null : spendDelta / baseline.spend;
          const incomeDelta = primary.income - baseline.income;
          const netDelta = primary.net - baseline.net;

          nextMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              timeframe: primary.timeframe,
              compareTo: baseline.timeframe,
              primary,
              baseline,
              deltas: {
                spend: spendDelta,
                spendPct: spendDeltaPct,
                income: incomeDelta,
                net: netDelta,
              },
            }),
          });
        }
      } else {
        nextMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: `Unknown tool: ${call.function.name}` }),
        });
      }
    }

    const second = await callOpenAI({ apiKey, model, messages: nextMessages, tools });
    if (!second.ok) {
      return NextResponse.json(
        { error: "Upstream AI provider error", details: second.text.slice(0, 2000) },
        { status: 502 }
      );
    }

    const finalText: string | undefined = second.data?.choices?.[0]?.message?.content ?? undefined;
    const assistantText = finalText?.trim() || "Sorry — I couldn't generate a response.";

    if (userId && sessionId && lastUserText) {
      await appendChatMessages({
        userId,
        sessionId,
        messages: [
          { role: "user", content: lastUserText },
          { role: "assistant", content: assistantText },
        ],
      });
    }

    return NextResponse.json({
      sessionId,
      message: {
        role: "assistant" as const,
        content: assistantText,
      },
    });
  }

  const content: string | undefined = firstMsg?.content ?? undefined;
  const assistantText = content?.trim() || "Sorry — I couldn't generate a response.";

  if (userId && sessionId && lastUserText) {
    await appendChatMessages({
      userId,
      sessionId,
      messages: [
        { role: "user", content: lastUserText },
        { role: "assistant", content: assistantText },
      ],
    });
  }

  return NextResponse.json({
    sessionId,
    message: {
      role: "assistant" as const,
      content: assistantText,
    },
  });
}
