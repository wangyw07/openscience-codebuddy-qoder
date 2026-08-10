const custom = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!"
const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** Qoder Cosy WAF body encoding (Encode=1). */
export function qoderEncodeBody(plaintext: string | Buffer) {
  const b64 = Buffer.isBuffer(plaintext) ? plaintext.toString("base64") : Buffer.from(plaintext).toString("base64")
  const n = b64.length
  const a = Math.floor(n / 3)
  const rearranged = b64.slice(n - a) + b64.slice(a, n - a) + b64.slice(0, a)
  let out = ""
  for (const c of rearranged) {
    if (c === "=") {
      out += "$"
      continue
    }
    const idx = standard.indexOf(c)
    out += idx >= 0 ? custom[idx] : c
  }
  return out
}
