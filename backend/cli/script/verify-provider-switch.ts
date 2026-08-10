#!/usr/bin/env bun
/** End-to-end regression: alternate providers/models in one conversation. */

const base = process.env.OPENSCIENCE_TEST_URL || "http://127.0.0.1:4096"
const created = await fetch(`${base}/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
})
if (!created.ok) throw new Error(`session create failed: ${created.status}`)
const session = (await created.json()) as { id: string }

const cases = [
  { providerID: "qoder", modelID: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
  { providerID: "qoder", modelID: "kimi-k3", name: "Kimi-K3" },
  { providerID: "codebuddy", modelID: "kimi-k2.7", name: "Kimi-K2.7-Code" },
  { providerID: "qoder", modelID: "glm-5.2", name: "GLM-5.2" },
  { providerID: "codebuddy", modelID: "glm-5.1", name: "GLM-5.1" },
] as const

const failures: string[] = []
for (const current of cases) {
  const response = await fetch(`${base}/session/${session.id}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: {
        providerID: current.providerID,
        modelID: current.modelID,
      },
      parts: [
        {
          type: "text",
          text: "你是哪个模型？请用简体中文，只回答本轮准确模型名称和完整模型 ID。",
        },
      ],
    }),
  })
  if (!response.ok) {
    failures.push(`${current.providerID}/${current.modelID}: HTTP ${response.status}`)
    continue
  }
  const message = (await response.json()) as {
    info: { providerID?: string; modelID?: string }
    parts: Array<{ type: string; text?: string }>
  }
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
  const expectedID = `${current.providerID}/${current.modelID}`
  const lowered = text.toLowerCase()
  if (message.info.providerID !== current.providerID || message.info.modelID !== current.modelID) {
    failures.push(
      `${expectedID}: metadata=${message.info.providerID}/${message.info.modelID}`,
    )
  }
  if (!lowered.includes(current.name.toLowerCase())) {
    failures.push(`${expectedID}: missing name ${current.name}: ${text}`)
  }
  if (!lowered.includes(expectedID)) {
    failures.push(`${expectedID}: missing exact ID: ${text}`)
  }
  if (/\(\s*auto\s*\)/i.test(text)) {
    failures.push(`${expectedID}: incorrectly appended Auto: ${text}`)
  }
  if (!/[\u4e00-\u9fff]/.test(text)) {
    failures.push(`${expectedID}: response is not Chinese: ${text}`)
  }
  for (const other of cases) {
    if (other === current) continue
    if (lowered.includes(other.name.toLowerCase())) {
      failures.push(`${expectedID}: leaked ${other.name}: ${text}`)
    }
  }
  console.log(JSON.stringify({ selected: expectedID, answer: text }))
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log("ALL CHECKS PASSED")
