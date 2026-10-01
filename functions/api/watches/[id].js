import { getWatchesFile, putWatchesFile, jsonResponse } from "../../_lib/github.js";
import { validateWatch } from "../../_lib/validate.js";

export async function onRequestPut(context) {
  const id = context.params.id;
  let watch;
  try {
    watch = await context.request.json();
  } catch {
    return jsonResponse({ error: "請求內容不是合法的 JSON" }, 400);
  }
  watch.id = id; // 網址上的 id 才是準的,不讓 body 偷改

  const error = validateWatch(watch);
  if (error) return jsonResponse({ error }, 400);

  try {
    const { data, sha } = await getWatchesFile(context.env);
    const watches = data.watches || [];
    const idx = watches.findIndex((w) => w.id === id);
    if (idx === -1) return jsonResponse({ error: `找不到 id "${id}"` }, 404);

    watches[idx] = watch;
    data.watches = watches;
    await putWatchesFile(context.env, data, sha, `chore(watches): update ${id} via web UI`);
    return jsonResponse(watch);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const id = context.params.id;
  try {
    const { data, sha } = await getWatchesFile(context.env);
    const watches = data.watches || [];
    const next = watches.filter((w) => w.id !== id);
    if (next.length === watches.length) {
      return jsonResponse({ error: `找不到 id "${id}"` }, 404);
    }
    data.watches = next;
    await putWatchesFile(context.env, data, sha, `chore(watches): remove ${id} via web UI`);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
