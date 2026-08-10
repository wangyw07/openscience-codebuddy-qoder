import { qoderExchangeURL, qoderMachineID, qoderMode, qoderUserInfoURL, type QoderMode } from "./cosy"

export type QoderSession = {
  jobToken: string
  userID: string
  name: string
  email: string
  machineID: string
  expiresAt: number
}

type Cache = {
  pat: string
  mode: QoderMode
  session: QoderSession
}

let cache: Cache | undefined

export async function qoderResolveSession(
  pat: string,
  mode: QoderMode = qoderMode(),
): Promise<QoderSession> {
  const now = Date.now()
  if (cache && cache.pat === pat && cache.mode === mode && cache.session.expiresAt > now + 60_000) {
    return cache.session
  }

  const exchange = await fetch(qoderExchangeURL(mode), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "openscience-qoder",
      "Cosy-Version": "1.0.1",
      "Cosy-ClientType": "5",
    },
    body: JSON.stringify({ personal_token: pat }),
  })
  if (!exchange.ok) {
    const text = await exchange.text().catch(() => "")
    throw new Error(`Qoder PAT exchange failed: ${exchange.status} ${exchange.statusText}. ${text.slice(0, 200)}`)
  }
  const data = (await exchange.json()) as {
    token?: string
    expires_at?: string
    expires_in?: number
  }
  if (!data.token) throw new Error("Qoder PAT exchange returned no job token")

  let expiresAt = now + 24 * 60 * 60 * 1000
  if (data.expires_at) {
    const parsed = Date.parse(data.expires_at)
    if (!Number.isNaN(parsed)) expiresAt = parsed
  } else if (data.expires_in) {
    expiresAt = now + data.expires_in
  }

  let userID = ""
  let name = ""
  let email = ""
  const infoRes = await fetch(qoderUserInfoURL(mode), {
    headers: {
      Authorization: `Bearer ${data.token}`,
      Accept: "application/json",
      "User-Agent": "openscience-qoder",
    },
  }).catch(() => undefined)
  if (infoRes?.ok) {
    const info = (await infoRes.json()) as { id?: string; name?: string; username?: string; email?: string }
    userID = info.id || ""
    name = info.name || info.username || ""
    email = info.email || ""
  }
  if (!userID) throw new Error("Qoder userinfo returned no user id")

  const session: QoderSession = {
    jobToken: data.token,
    userID,
    name: name || (mode === "cn" ? "Qoder CN User" : "Qoder User"),
    email: email || (mode === "cn" ? "user@qoder.com.cn" : "user@qoder.com"),
    machineID: qoderMachineID(),
    expiresAt,
  }
  cache = { pat, mode, session }
  return session
}
