#!/usr/bin/env bun
/**
 * Copy missing Qoder env aliases from repo-root .env into backend/cli/.env
 * so `bun --cwd backend/cli` / loadProjectDotenv(cwd) can see them.
 * Never prints secret values.
 */
import fs from "fs"
import path from "path"

const root = path.resolve(import.meta.dir, "../../..")
const rootEnv = path.join(root, ".env")
const cliEnv = path.join(root, "backend/cli/.env")
const aliases = ["QODER_API_KEY", "QODER_PAT", "QODER_PERSONAL_ACCESS_TOKEN"]

function parse(file: string) {
  const map = new Map<string, string>()
  if (!fs.existsSync(file)) return map
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim())
  }
  return map
}

const from = parse(rootEnv)
const to = parse(cliEnv)
const added: string[] = []
for (const key of aliases) {
  const value = from.get(key)
  if (!value) continue
  if (to.has(key) && to.get(key)) continue
  to.set(key, value)
  added.push(key)
}
if (!added.length) {
  console.log("cli .env already has Qoder key aliases (or root has none)")
  process.exit(0)
}

const lines = fs.existsSync(cliEnv) ? fs.readFileSync(cliEnv, "utf8").replace(/\s*$/, "") : ""
const append = added.map((key) => `${key}=${to.get(key)}`).join("\n")
fs.writeFileSync(cliEnv, `${lines}${lines ? "\n" : ""}${append}\n`, "utf8")
console.log("added to backend/cli/.env:", added.join(", "))
