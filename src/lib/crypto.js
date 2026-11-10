// Password protection for exported settings, using the browser's Web Crypto
// (no server, nothing stored): PBKDF2-SHA256 turns the password into an
// AES-GCM key, and AES-GCM encrypts the settings JSON. The salt and IV are
// random per file and stored in it (they aren't secret). The iteration count
// is stored too, so it can be raised later without breaking older files.

export const PBKDF2_ITERATIONS = 600000
export const MIN_PASSWORD_LENGTH = 8
// A file can't ask for more work than this (a crafted file could freeze the page).
const MAX_ITERATIONS = 10000000

const KDF = "PBKDF2-SHA256"
const CIPHER = "AES-GCM"

export class WrongPasswordError extends Error {}
export class UnsupportedFileError extends Error {}

// Web Crypto only exists on HTTPS and localhost.
export const cryptoAvailable = () => !!globalThis.crypto?.subtle

const toBase64 = (bytes) => {
  let text = ""
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

const deriveKey = async (password, salt, iterations) => {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

// Returns the `encryption` parameters and the base64 `data` to store in the file.
export async function encryptText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)))
  return {
    encryption: { kdf: KDF, iterations: PBKDF2_ITERATIONS, cipher: CIPHER, salt: toBase64(salt), iv: toBase64(iv) },
    data: toBase64(data),
  }
}

// AES-GCM checks the data as it decrypts, so a wrong password and a damaged
// file both end up as WrongPasswordError.
export async function decryptText({ encryption, data }, password) {
  const { kdf, cipher, iterations, salt, iv } = encryption || {}
  let params
  try {
    if (kdf !== KDF || cipher !== CIPHER) throw new Error()
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) throw new Error()
    params = { salt: fromBase64(salt), iv: fromBase64(iv), data: fromBase64(data) }
  } catch {
    throw new UnsupportedFileError()
  }
  const key = await deriveKey(password, params.salt, iterations)
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: params.iv }, key, params.data))
  } catch {
    throw new WrongPasswordError()
  }
}
