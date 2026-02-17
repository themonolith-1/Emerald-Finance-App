export async function callHuggingFaceTextGeneration(params: {
  apiKey: string;
  model: string;
  prompt: string;
}) {
  const authHeader = { authorization: `Bearer ${params.apiKey}` };

  function parseClassicGeneratedText(data: unknown): string {
    if (Array.isArray(data)) {
      const first = data[0] as unknown;
      if (
        first &&
        typeof first === "object" &&
        "generated_text" in first &&
        typeof (first as { generated_text?: unknown }).generated_text === "string"
      ) {
        return (first as { generated_text: string }).generated_text;
      }
    }

    if (data && typeof data === "object" && "generated_text" in data) {
      const gt = (data as { generated_text?: unknown }).generated_text;
      if (typeof gt === "string") return gt;
    }

    return "";
  }

  function parseChatCompletionText(data: unknown): string {
    // OpenAI-compatible shape:
    // { choices: [ { message: { content: "..." } } ] }
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

  async function tryClassic() {
    const upstream = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(params.model)}`, {
      method: "POST",
      headers: {
        ...authHeader,
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

    const data: unknown = await upstream.json().catch(() => null);
    const generated = parseClassicGeneratedText(data);
    return { ok: true as const, text: generated.trim() };
  }

  async function tryChatCompletions() {
    const upstream = await fetch("https://api-inference.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        ...authHeader,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        messages: [{ role: "user", content: params.prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return { ok: false as const, status: upstream.status, text };
    }

    const data: unknown = await upstream.json().catch(() => null);
    const content = parseChatCompletionText(data);
    return { ok: true as const, text: content.trim() };
  }

  const classic = await tryClassic();
  if (classic.ok && classic.text) return classic;

  // Common cases where classic inference is unavailable: model gated/disabled or
  // served only via chat-completions-compatible endpoint.
  if (!classic.ok && (classic.status === 404 || classic.status === 403 || classic.status === 410)) {
    const chat = await tryChatCompletions();
    if (chat.ok && chat.text) return chat;
    if (!chat.ok) {
      return {
        ok: false as const,
        status: chat.status,
        text: `Classic inference failed (${classic.status}): ${classic.text}\n\nChat-completions failed (${chat.status}): ${chat.text}`,
      };
    }
  }

  return classic;
}
