import crypto from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"

const rsaPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`

const ideVersion = "1.1.3"
const clientType = "5"
const dataPolicy = "disagree"
const loginVersion = "v2"
const machineType = "5"

export type QoderMode = "global" | "cn"

export function qoderMode(getEnv: (name: string) => string | undefined = (name) => process.env[name]): QoderMode {
  const raw = (getEnv("QODER_REGION") || getEnv("QODER_BACKEND") || getEnv("QODER_MODE") || "").toLowerCase()
  if (["cn", "china", "qodercn", "qoder-cn"].includes(raw)) return "cn"
  if (["global", "intl", "international", "qoder"].includes(raw)) return "global"
  if ((getEnv("QODERCN_API_KEY") || getEnv("QODERCN_PAT") || getEnv("QODERCN_PERSONAL_ACCESS_TOKEN")) &&
    !(getEnv("QODER_API_KEY") || getEnv("QODER_PAT") || getEnv("QODER_PERSONAL_ACCESS_TOKEN"))) {
    return "cn"
  }
  return "global"
}

export function qoderBaseURL(getEnv: (name: string) => string | undefined = (name) => process.env[name]) {
  const override = getEnv("QODER_BASE_URL")?.trim()
  if (override) return override.replace(/\/+$/, "")
  // Synthetic OpenAI-compatible root; qoderFetch rewrites to Cosy.
  // Must be http (not https): Bun TLS against this fake host surfaces as
  // "unknown certificate verification error" if any request falls through.
  return "http://qoder.openscience.local/v1"
}

export function qoderGatewayURL(mode: QoderMode = qoderMode()) {
  return mode === "cn" ? "https://gateway.qoder.com.cn/" : "https://api3.qoder.sh/"
}

export function qoderOpenApiURL(mode: QoderMode = qoderMode()) {
  return mode === "cn" ? "https://openapi.qoder.com.cn" : "https://openapi.qoder.sh"
}

export function qoderChatURL(mode: QoderMode = qoderMode()) {
  return `${qoderGatewayURL(mode)}algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`
}

export function qoderExchangeURL(mode: QoderMode = qoderMode()) {
  return `${qoderOpenApiURL(mode)}/api/v1/jobToken/exchange`
}

export function qoderUserInfoURL(mode: QoderMode = qoderMode()) {
  return `${qoderOpenApiURL(mode)}/api/v1/userinfo`
}

export function qoderMachineOS() {
  if (process.platform === "win32") return process.arch === "arm64" ? "aarch64_windows" : "x86_64_windows"
  return process.arch === "arm64" ? "aarch64_linux" : "x86_64_linux"
}

export function qoderMachineID() {
  const paths = [
    join(homedir(), ".qoder", ".auth", "machine_id"),
    join(homedir(), ".config", "openscience", "qoder-machine-id"),
  ]
  for (const path of paths) {
    if (!existsSync(path)) continue
    const value = readFileSync(path, "utf8").trim()
    if (value) return value
  }
  const id = crypto.randomUUID()
  const save = paths[1]
  mkdirSync(dirname(save), { recursive: true })
  writeFileSync(save, id, "utf8")
  return id
}

function rsaEncrypt(data: string) {
  return crypto
    .publicEncrypt({ key: rsaPublicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(data))
    .toString("base64")
}

function aesEncrypt(plaintext: string, key: string) {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(key))
  return cipher.update(plaintext, "utf8", "base64") + cipher.final("base64")
}

function sigPath(url: string) {
  const path = new URL(url).pathname
  if (path.startsWith("/algo")) return path.slice("/algo".length)
  return path
}

export type QoderCreds = {
  userID: string
  authToken: string
  name?: string
  email?: string
  machineID?: string
}

export function qoderAuthHeaders(body: Buffer, requestURL: string, creds: QoderCreds) {
  if (!creds.userID) throw new Error("qoder: user id is empty")
  if (!creds.authToken) throw new Error("qoder: auth token is empty")

  const aesKey = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  const info = aesEncrypt(
    JSON.stringify({
      uid: creds.userID,
      security_oauth_token: creds.authToken,
      name: creds.name || "",
      aid: "",
      email: creds.email || "",
    }),
    aesKey,
  )
  const cosyKey = rsaEncrypt(aesKey)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const requestId = crypto.randomUUID()
  const payload = Buffer.from(
    JSON.stringify({
      version: "v1",
      requestId,
      info,
      cosyVersion: ideVersion,
      ideVersion: "",
    }),
  ).toString("base64")
  const path = sigPath(requestURL)
  const bodyStr = body.toString("utf8")
  const sig = crypto.createHash("md5").update(`${payload}\n${cosyKey}\n${timestamp}\n${bodyStr}\n${path}`).digest("hex")
  const bodyHash = crypto.createHash("md5").update(body).digest("hex")
  const machineID = creds.machineID || qoderMachineID()

  return {
    Authorization: `Bearer COSY.${payload}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userID,
    "Cosy-Date": timestamp,
    "Cosy-Version": ideVersion,
    "Cosy-Machineid": machineID,
    "Cosy-Machinetoken": machineID,
    "Cosy-Machinetype": machineType,
    "Cosy-Machineos": qoderMachineOS(),
    "Cosy-Clienttype": clientType,
    "Cosy-Clientip": "127.0.0.1",
    "Cosy-Bodyhash": bodyHash,
    "Cosy-Bodylength": String(body.length),
    "Cosy-Sigpath": path,
    "Cosy-Data-Policy": dataPolicy,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": loginVersion,
    "X-Request-Id": crypto.randomUUID(),
  }
}

/** Map friendly / alias model ids to Qoder Cosy gateway keys. */
export function qoderModelKey(modelID: string) {
  return (
    {
      "qwen3.8-max": "qmodel_38max",
      "qwen3.7-max": "qmodel_latest",
      "qwen3.7-plus": "qmodel",
      "qwen3.6-plus": "qmodel",
      "deepseek-v4-pro": "dmodel",
      "deepseek-v4-flash": "dfmodel",
      "glm-5.2": "gm51model",
      "kimi-k2.7": "kmodel",
      "kimi-k2.7-code": "kmodel",
      "kimi-k2.6": "kmodel",
      "kimi-k3": "kmodel_latest",
      "minimax-m3": "mmodel",
      cantus: "cmodel",
      // Pass-through for already-resolved Cosy keys (legacy sessions/config).
      qmodel_38max: "qmodel_38max",
      qmodel_latest: "qmodel_latest",
      qmodel: "qmodel",
      dmodel: "dmodel",
      dfmodel: "dfmodel",
      gm51model: "gm51model",
      kmodel: "kmodel",
      kmodel_latest: "kmodel_latest",
      mmodel: "mmodel",
      cmodel: "cmodel",
    }[modelID] || modelID
  )
}

/** Friendly catalog id for prompts / SSE (inverse of common Cosy keys). */
export function qoderPublicModelId(modelID: string) {
  return (
    {
      qmodel_38max: "qwen3.8-max",
      qmodel_latest: "qwen3.7-max",
      qmodel: "qwen3.7-plus",
      dmodel: "deepseek-v4-pro",
      dfmodel: "deepseek-v4-flash",
      gm51model: "glm-5.2",
      kmodel: "kimi-k2.7",
      kmodel_latest: "kimi-k3",
      mmodel: "minimax-m3",
      cmodel: "cantus",
    }[modelID] || modelID
  )
}

