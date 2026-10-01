// 透過 GitHub Contents API 讀寫 config/watches.json,當作這個工具的「寫入後端」。
// 需要的環境變數(在 Cloudflare Pages 專案設定裡設):
//   GITHUB_TOKEN  - fine-grained PAT,只需要這個 repo 的 Contents: Read and write
//   GITHUB_OWNER  - repo 擁有者(使用者名稱或組織名)
//   GITHUB_REPO   - repo 名稱
//   GITHUB_BRANCH - 分支名稱,通常是 main

const CONFIG_PATH = "config/watches.json";

function apiUrl(env) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${CONFIG_PATH}`;
}

function authHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ftpt-manage-ui",
  };
}

// GitHub 回傳/要求的 content 是 base64,但內容有中文(UTF-8),不能直接用 atob/btoa。
function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function getWatchesFile(env) {
  const res = await fetch(`${apiUrl(env)}?ref=${env.GITHUB_BRANCH}`, {
    headers: authHeaders(env),
  });
  if (!res.ok) {
    throw new Error(`讀取 GitHub 上的設定檔失敗 (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  const data = JSON.parse(base64DecodeUtf8(json.content));
  return { data, sha: json.sha };
}

export async function putWatchesFile(env, data, sha, message) {
  const content = base64EncodeUtf8(JSON.stringify(data, null, 2) + "\n");
  const res = await fetch(apiUrl(env), {
    method: "PUT",
    headers: { ...authHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content,
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });
  if (!res.ok) {
    throw new Error(`寫回 GitHub 上的設定檔失敗 (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
