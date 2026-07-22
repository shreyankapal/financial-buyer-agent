import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

const CACHE_DIR = "./cache";

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

function cachePath(key) {
  return join(CACHE_DIR, `${hashKey(key)}.json`);
}

export async function getCached(key) {
  try {
    const raw = await readFile(cachePath(key), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCache(key, value) {
  await mkdir(CACHE_DIR, { recursive: true });
  const entry = { key, value, cachedAt: new Date().toISOString() };
  await writeFile(cachePath(key), JSON.stringify(entry, null, 2), "utf8");
}

export async function getOrFetch(key, fetchFunction) {
  const cached = await getCached(key);
  if (cached) {
    console.log("cache hit");
    return cached.value;
  }

  console.log("cache miss, fetched fresh");
  const value = await fetchFunction();
  await setCache(key, value);
  return value;
}
