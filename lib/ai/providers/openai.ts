export type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export async function callOpenAI(params: {
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
    return { ok: false as const, status: upstream.status, text };
  }

  const data: unknown = await upstream.json().catch(() => null);
  return { ok: true as const, data };
}
