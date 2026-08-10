/**
 * CodeBuddy's chat API only accepts stream=true. OpenScience sometimes calls
 * generateObject / doGenerate with stream=false (titles, structured output).
 * This fetch wrapper forces streaming upstream and, when the client asked for
 * a non-stream response, aggregates SSE chunks into one chat.completion body.
 *
 * Also strips tool JSON Schema features that CodeBuddy Auto rejects
 * (draft-2020 `$schema`, top-level anyOf/oneOf from Zod discriminatedUnion).
 */
export async function codebuddyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!init?.body || (init.method && init.method !== "POST")) {
    return fetch(input, init)
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(typeof init.body === "string" ? init.body : await new Response(init.body).text())
  } catch {
    return fetch(input, init)
  }

  if (Array.isArray(body.tools)) {
    body = { ...body, tools: sanitizeTools(body.tools) }
  }
  // CodeBuddy does not document stream_options; drop to avoid picky models.
  if (body.stream_options) {
    const { stream_options: _drop, ...rest } = body
    body = rest
  }

  const clientWantedStream = body.stream === true
  if (!clientWantedStream) {
    body = { ...body, stream: true }
  }
  init = { ...init, body: JSON.stringify(body) }

  const response = await fetch(input, init)
  if (clientWantedStream || !response.ok || !response.body) return response

  const raw = await response.text()
  const aggregated = aggregateSse(raw)
  return new Response(JSON.stringify(aggregated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function sanitizeTools(tools: unknown[]) {
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool
    const entry = tool as { type?: string; function?: { parameters?: unknown; [k: string]: unknown } }
    if (entry.type !== "function" || !entry.function?.parameters || typeof entry.function.parameters !== "object") {
      return tool
    }
    return {
      ...entry,
      function: {
        ...entry.function,
        parameters: sanitizeParameters(entry.function.parameters),
      },
    }
  })
}

function sanitizeParameters(schema: unknown): unknown {
  const walk = (node: any): any => {
    if (node === null || typeof node !== "object") return node
    if (Array.isArray(node)) return node.map(walk)
    const out: any = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === "$schema" || key === "$id" || key === "default") continue
      if (key === "const") {
        out.enum = [value]
        continue
      }
      out[key] = walk(value)
    }
    const variants = Array.isArray(out.anyOf) ? out.anyOf : Array.isArray(out.oneOf) ? out.oneOf : undefined
    if (variants?.length && variants.every((v: any) => v && typeof v === "object" && (v.type === "object" || v.properties))) {
      const properties: Record<string, any> = {}
      for (const variant of variants) {
        for (const [key, value] of Object.entries(variant.properties ?? {})) {
          const next = walk(value)
          const prev = properties[key]
          if (!prev) {
            properties[key] = next
            continue
          }
          const enums = [...new Set([...(prev.enum ?? []), ...(next.enum ?? [])])]
          properties[key] = { ...prev, ...next, ...(enums.length ? { enum: enums } : {}) }
          delete properties[key].const
        }
      }
      const every = (variants as any[])
        .map((v) => new Set<string>((v.required ?? []) as string[]))
        .reduce((a: Set<string> | null, b: Set<string>) => {
          if (!a) return b
          return new Set([...a].filter((k) => b.has(k)))
        }, null as Set<string> | null)
      return {
        type: "object",
        properties,
        required: [...(every ?? [])].filter((key) => key in properties),
        additionalProperties: false,
      }
    }
    return out
  }
  return walk(schema)
}

function aggregateSse(raw: string) {
  let id = "chatcmpl-codebuddy"
  let model = "codebuddy"
  let created = Math.floor(Date.now() / 1000)
  let role = "assistant"
  let content = ""
  let reasoning = ""
  const toolCalls: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
    index: number
  }> = []
  let finishReason: string | null = "stop"
  let usage: unknown

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (!data || data === "[DONE]") continue
    let chunk: any
    try {
      chunk = JSON.parse(data)
    } catch {
      continue
    }
    if (chunk.id) id = chunk.id
    if (chunk.model) model = chunk.model
    if (chunk.created) created = chunk.created
    if (chunk.usage) usage = chunk.usage

    const choice = chunk.choices?.[0]
    if (!choice) continue
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta ?? choice.message ?? {}
    if (typeof delta.role === "string") role = delta.role
    if (typeof delta.content === "string") content += delta.content
    if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content

    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) {
        const index = typeof call.index === "number" ? call.index : toolCalls.length
        const existing = toolCalls[index]
        if (!existing) {
          toolCalls[index] = {
            id: call.id ?? `call_${index}`,
            type: "function",
            index,
            function: {
              name: call.function?.name ?? "",
              arguments: call.function?.arguments ?? "",
            },
          }
        } else {
          if (call.id) existing.id = call.id
          if (call.function?.name) existing.function.name += call.function.name
          if (call.function?.arguments) existing.function.arguments += call.function.arguments
        }
      }
    }
  }

  const message: Record<string, unknown> = {
    role,
    content: content || null,
  }
  if (reasoning) message.reasoning_content = reasoning
  const calls = toolCalls.filter(Boolean)
  if (calls.length) {
    message.tool_calls = calls.map(({ id: callId, type, function: fn }) => ({
      id: callId,
      type,
      function: fn,
    }))
    if (!finishReason || finishReason === "stop") finishReason = "tool_calls"
  }

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason || "stop",
      },
    ],
    usage: usage ?? undefined,
  }
}

export function codebuddyBaseURL(getEnv: (name: string) => string | undefined = (name) => process.env[name]) {
  const override = getEnv("CODEBUDDY_BASE_URL")?.trim()
  if (override) return override.replace(/\/+$/, "")

  const region = getEnv("CODEBUDDY_INTERNET_ENVIRONMENT")?.trim()
  if (region === "public") return "https://www.codebuddy.ai/v2"
  if (region === "ioa") return "https://tencent.sso.copilot.tencent.com/v2"
  // Default to China — profile keys from copilot.tencent.com / codebuddy.cn
  return "https://www.codebuddy.cn/v2"
}
