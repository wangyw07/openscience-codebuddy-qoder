import crypto from "crypto"
import { Env } from "../../env"
import {
  qoderAuthHeaders,
  qoderChatURL,
  qoderMode,
  qoderModelKey,
  qoderPublicModelId,
} from "./cosy"
import { qoderEncodeBody } from "./encoding"
import { qoderResolveSession } from "./session"

function envGet(name: string) {
  try {
    return Env.get(name)
  } catch {
    return process.env[name]
  }
}

type OpenAIMessage = {
  role?: string
  content?: unknown
  tool_calls?: Array<{
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
  tool_call_id?: string
  name?: string
}

function lastUserText(messages: OpenAIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "user") continue
    const content = messages[i].content
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
      return content
        .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text?: string }).text ?? "") : ""))
        .join("")
    }
  }
  return ""
}

function normalizeMessages(messages: OpenAIMessage[]) {
  const out: OpenAIMessage[] = []
  for (const msg of messages) {
    if (!msg?.role) continue
    if (msg.role === "system") {
      out.push({ role: "system", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) })
      continue
    }
    if (msg.role === "assistant") {
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content == null
            ? toolCalls.length
              ? " "
              : null
            : JSON.stringify(msg.content)
      const mapped: OpenAIMessage = { role: "assistant", content }
      if (toolCalls.length) mapped.tool_calls = toolCalls
      out.push(mapped)
      continue
    }
    if (msg.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: msg.tool_call_id,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
      })
      continue
    }
    out.push({
      role: msg.role,
      content: msg.content ?? "",
    })
  }
  return out
}

function extractApiKey(init?: RequestInit) {
  const headers = init?.headers
  if (!headers) return undefined
  const get = (name: string) => {
    if (headers instanceof Headers) return headers.get(name) ?? undefined
    if (Array.isArray(headers)) {
      const hit = headers.find(([k]) => k.toLowerCase() === name.toLowerCase())
      return hit?.[1]
    }
    const record = headers as Record<string, string>
    return record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()]
  }
  const auth = get("authorization") || get("Authorization")
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim()
  return get("x-api-key") || get("api-key")
}

function isSyntheticQoder(url: string) {
  return url.includes("qoder.openscience.local")
}

function isChatCompletions(url: string) {
  return /\/chat\/completions\/?(\?|$)/.test(url) || isSyntheticQoder(url)
}

function sanitizeQoderTools(tools: unknown[]) {
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
        parameters: sanitizeQoderParameters(entry.function.parameters),
      },
    }
  })
}

function sanitizeQoderParameters(schema: unknown): unknown {
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

/** Qoder wraps quota/plan errors as `{"code":"112","message":"{\"pricingUrl\":...}"}`. Surface something a user can act on. */
function qoderFriendlyError(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.code === "112") {
      const pricingUrl = (() => {
        try {
          const inner = JSON.parse(parsed.message)
          return inner?.pricingUrl || "https://qoder.com/pricing?client=qoder"
        } catch {
          return "https://qoder.com/pricing?client=qoder"
        }
      })()
      return `Qoder 该模型额度已用尽或需要付费套餐才能使用，请前往 ${pricingUrl} 升级套餐，或切换到 Qoder Lite 模型继续对话。`
    }
    if (typeof parsed?.message === "string" && parsed.message) return parsed.message
  } catch {}
  return raw
}

function unwrapCosySse(raw: string) {
  let id = "chatcmpl-qoder"
  let model = "qoder"
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
  let upstreamError: string | undefined

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (!data || data === "[DONE]") continue
    let envelope: any
    try {
      envelope = JSON.parse(data)
    } catch {
      continue
    }
    if (envelope.statusCodeValue && envelope.statusCodeValue !== 200) {
      upstreamError = typeof envelope.body === "string" ? envelope.body : JSON.stringify(envelope.body ?? envelope)
      continue
    }
    const innerStr = envelope.body
    if (!innerStr || innerStr === "[DONE]") continue
    let chunk: any
    try {
      chunk = typeof innerStr === "string" ? JSON.parse(innerStr) : innerStr
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

  if (upstreamError) {
    return { error: upstreamError }
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
    completion: {
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
    },
  }
}

function toOpenAiSse(raw: string, clientModel: string) {
  const chunks: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const out = cosyLineToOpenAi(line, clientModel)
    if (out) chunks.push(out)
  }
  if (!chunks.some((c) => c.includes("[DONE]"))) chunks.push("data: [DONE]\n\n")
  return chunks.join("")
}

function rewriteModelField(inner: string, clientModel: string) {
  try {
    const parsed = JSON.parse(inner)
    if (parsed && typeof parsed === "object") {
      parsed.model = clientModel
      return JSON.stringify(parsed)
    }
  } catch {}
  return inner
}

/** Convert one Cosy SSE `data:` line into OpenAI-compatible SSE bytes text. */
function cosyLineToOpenAi(line: string, clientModel: string): string | undefined {
  if (!line.startsWith("data:")) return
  const data = line.slice(5).trim()
  if (!data) return
  if (data === "[DONE]") return "data: [DONE]\n\n"
  let envelope: any
  try {
    envelope = JSON.parse(data)
  } catch {
    return
  }
  if (envelope.statusCodeValue && envelope.statusCodeValue !== 200) {
    const err = typeof envelope.body === "string" ? envelope.body : JSON.stringify(envelope.body ?? envelope)
    return (
      `data: ${JSON.stringify({
        error: {
          message: qoderFriendlyError(err),
          type: "qoder_error",
          code: envelope.statusCodeValue,
        },
      })}\n\n` + "data: [DONE]\n\n"
    )
  }
  const inner = envelope.body
  if (!inner) return
  if (inner === "[DONE]") return "data: [DONE]\n\n"
  const payload = typeof inner === "string" ? rewriteModelField(inner, clientModel) : JSON.stringify({ ...inner, model: clientModel })
  return `data: ${payload}\n\n`
}

/** True streaming: Cosy SSE → OpenAI SSE, flushed as upstream chunks arrive. */
function pipeCosyToOpenAi(response: Response, clientModel: string): Response {
  if (!response.body) {
    return new Response(toOpenAiSse("", clientModel), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  }

  const upstream = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  let sawDone = false

  // Cosy occasionally stalls mid-stream with no error and no more bytes; never hang the client forever.
  const idleMs = 45_000
  const readChunk = () =>
    new Promise<Awaited<ReturnType<typeof upstream.read>>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Qoder 响应超时：模型长时间未返回数据，请重试")), idleMs)
      upstream.read().then(
        (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })

  // Push-based pump in `start`: relying on the platform to re-invoke a lazy
  // `pull()` after every enqueue has proven unreliable for fast/bursty
  // upstream chunks (the stream can go idle forever despite desiredSize > 0
  // and no pending read). Driving our own loop sidesteps that entirely.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (;;) {
          const { done, value } = await readChunk()
          if (done) {
            if (buffer.length) {
              const out = cosyLineToOpenAi(buffer, clientModel)
              if (out) {
                if (out.includes("[DONE]")) sawDone = true
                controller.enqueue(encoder.encode(out))
              }
              buffer = ""
            }
            if (!sawDone) controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()
            return
          }

          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split(/\r?\n/)
          buffer = parts.pop() ?? ""
          for (const line of parts) {
            const out = cosyLineToOpenAi(line, clientModel)
            if (!out) continue
            controller.enqueue(encoder.encode(out))
            if (out.includes("[DONE]")) {
              sawDone = true
              try {
                await upstream.cancel()
              } catch {}
              controller.close()
              return
            }
            // Cosy sometimes omits a terminal [DONE]; close after a final choice.
            if (/"finish_reason"\s*:\s*"(?:stop|tool_calls|length)"/.test(out)) {
              sawDone = true
              controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              try {
                await upstream.cancel()
              } catch {}
              controller.close()
              return
            }
          }
        }
      } catch (error) {
        try {
          await upstream.cancel()
        } catch {}
        const message = error instanceof Error ? error.message : String(error)
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              error: { message: qoderFriendlyError(message), type: "qoder_error", code: 504 },
            })}\n\n` + "data: [DONE]\n\n",
          ),
        )
        controller.close()
      }
    },
    cancel() {
      return upstream.cancel()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

/**
 * OpenAI-compatible fetch adapter for Qoder.
 * Translates /v1/chat/completions into Cosy agent_chat_generation SSE.
 */
export async function qoderFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

  // Never dial the synthetic host — it has no TLS cert / listener.
  if (isSyntheticQoder(url) && (!init?.body || (init.method && init.method !== "POST") || !isChatCompletions(url))) {
    return new Response(JSON.stringify({ error: { message: "Qoder adapter only supports POST /chat/completions", type: "invalid_request" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!init?.body || (init.method && init.method !== "POST") || !isChatCompletions(url)) {
    return fetch(input, init)
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(typeof init.body === "string" ? init.body : await new Response(init.body).text())
  } catch {
    if (isSyntheticQoder(url)) {
      return new Response(JSON.stringify({ error: { message: "Qoder request body is not valid JSON", type: "invalid_request" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }
    return fetch(input, init)
  }

  const apiKey =
    extractApiKey(init) ||
    envGet("QODER_API_KEY") ||
    envGet("QODER_PAT") ||
    envGet("QODER_PERSONAL_ACCESS_TOKEN") ||
    process.env.QODER_API_KEY ||
    process.env.QODER_PAT ||
    process.env.QODER_PERSONAL_ACCESS_TOKEN
  const resolved =
    apiKey && !apiKey.startsWith("{env:") && apiKey.trim() ? apiKey.trim() : undefined
  if (!resolved) {
    return new Response(JSON.stringify({ error: { message: "Qoder API key missing", type: "auth_error" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  const mode = qoderMode()
  const session = await qoderResolveSession(resolved, mode)
  const requestedModel = qoderPublicModelId(String(body.model || "auto"))
  const model = qoderModelKey(requestedModel)
  const messages = normalizeMessages((body.messages as OpenAIMessage[]) || [])
  const tools = Array.isArray(body.tools) ? sanitizeQoderTools(body.tools) : []
  const maxTokens =
    typeof body.max_tokens === "number"
      ? body.max_tokens
      : typeof body.max_completion_tokens === "number"
        ? body.max_completion_tokens
        : 8192
  const prompt = lastUserText(messages)
  const record = crypto.createHash("sha256").update(JSON.stringify({ model, messages, tools, maxTokens })).digest("hex").slice(0, 16)
  const sessionID = crypto.randomUUID()
  const isReasoning =
    model === "ultimate" ||
    model === "performance" ||
    model.includes("dmodel") ||
    model.includes("dfmodel") ||
    model.includes("qmodel")

  const reqBody = {
    request_id: crypto.randomUUID(),
    request_set_id: record,
    chat_record_id: record,
    session_id: sessionID,
    stream: true,
    chat_task: "FREE_INPUT",
    is_reply: true,
    is_retry: false,
    source: 1,
    version: "3",
    session_type: "qodercli",
    agent_id: "agent_common",
    task_id: "common",
    code_language: "",
    chat_prompt: "",
    image_urls: null,
    aliyun_user_type: "",
    system: "",
    messages,
    tools,
    parameters: { max_tokens: maxTokens },
    chat_context: {
      chatPrompt: "",
      imageUrls: null,
      extra: {
        context: [],
        modelConfig: { key: model, is_reasoning: isReasoning },
        originalContent: prompt,
      },
      features: [],
      text: prompt,
    },
    model_config: {
      key: model,
      is_reasoning: isReasoning,
      max_output_tokens: maxTokens,
      source: "system",
    },
    business: {
      product: "cli",
      version: "1.0.0",
      type: "agent",
      stage: "start",
      id: crypto.randomUUID(),
      name: prompt.slice(0, 30),
      begin_at: Date.now(),
    },
  }

  const encoded = Buffer.from(qoderEncodeBody(Buffer.from(JSON.stringify(reqBody))), "utf8")
  const chatURL = qoderChatURL(mode)
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "Cache-Control": "no-cache",
    "Accept-Encoding": "identity",
    "User-Agent": "openscience-qoder",
    "X-Model-Key": model,
    "X-Model-Source": "system",
    ...qoderAuthHeaders(encoded, chatURL, {
      userID: session.userID,
      authToken: session.jobToken,
      name: session.name,
      email: session.email,
      machineID: session.machineID,
    }),
  }

  const response = await fetch(chatURL, {
    method: "POST",
    headers,
    body: encoded,
    signal: init.signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return new Response(
      JSON.stringify({
        error: {
          message: `Qoder chat failed: ${response.status} ${response.statusText}. ${text.slice(0, 400)}`,
          type: "qoder_error",
          code: response.status,
        },
      }),
      { status: response.status, headers: { "Content-Type": "application/json" } },
    )
  }

  const clientWantedStream = body.stream === true
  if (clientWantedStream) {
    return pipeCosyToOpenAi(response, requestedModel)
  }

  const raw = await readSseBody(response)
  const aggregated = unwrapCosySse(raw)
  if ("error" in aggregated && aggregated.error) {
    let status = 400
    try {
      const parsed = JSON.parse(aggregated.error)
      if (parsed?.code === "112") status = 402
    } catch {}
    return new Response(
      JSON.stringify({
        error: {
          message: qoderFriendlyError(aggregated.error),
          type: "qoder_error",
          code: status,
        },
      }),
      { status, headers: { "Content-Type": "application/json" } },
    )
  }

  if (aggregated.completion) aggregated.completion.model = requestedModel
  return new Response(JSON.stringify(aggregated.completion), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

async function readSseBody(response: Response) {
  if (!response.body) return await response.text().catch(() => "")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let raw = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      raw += decoder.decode(value, { stream: true })
      // Cosy often closes the socket right after a terminal error event.
      if (raw.includes('"statusCodeValue":403') || raw.includes('"statusCodeValue":402') || raw.includes("data: [DONE]")) {
        break
      }
    }
  } catch {
    // Upstream may RST after emitting the error SSE; keep what we have.
  } finally {
    try {
      await reader.cancel()
    } catch {}
  }
  return raw
}
