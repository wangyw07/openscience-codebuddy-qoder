#!/usr/bin/env bun

/**
 * Fresh clones have no frontend/workspace/dist and no gitignored
 * assets.generated.ts — without them `bun dev` serves 404 for /.
 * Build + regenerate once when either is missing.
 */
import fs from "fs"
import path from "path"
import { $ } from "bun"
import { fileURLToPath } from "url"

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const root = path.resolve(cli, "../..")
const dist = path.join(root, "frontend/workspace/dist/index.html")
const manifest = path.join(cli, "src/web/assets.generated.ts")

if (fs.existsSync(dist) && fs.existsSync(manifest)) process.exit(0)

console.log("Web UI assets missing — building frontend/workspace…")
await $`bun run build`.cwd(path.join(root, "frontend/workspace"))
await $`bun run script/generate-web-assets.ts`.cwd(cli)
