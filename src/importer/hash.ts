export async function calculateSha256(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source.buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
