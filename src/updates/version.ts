export type VersionComparison = "newer" | "same" | "older";

export function parseStableVersion(value: string, tag = false): string | null {
  if (value.length > 128 || value !== value.trim()) return null;
  const pattern = tag ? /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/ : /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  const match = pattern.exec(value);
  return match ? match.slice(1).join(".") : null;
}

export function compareStableVersions(current: string, published: string): VersionComparison {
  const left = current.split(".").map(BigInt);
  const right = published.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (right[i] > left[i]) return "newer";
    if (right[i] < left[i]) return "older";
  }
  return "same";
}
