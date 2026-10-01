import { getWatchesFile, putWatchesFile, jsonResponse } from "../../_lib/github.js";
import { validateWatch } from "../../_lib/validate.js";

export async function onRequestGet(context) {
  try {
    const { data } = await getWatchesFile(context.env);
    return jsonResponse(data.watches || []);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  let watch;
  try {
    watch = await context.request.json();
  } catch {
    return jsonResponse({ error: "請求內容不是合法的 JSON" }, 400);
  }

  const error = validateWatch(watch);
  if (error) return jsonResponse({ error }, 400);

  try {
    const { data, sha } = await getWatchesFile(context.env);
    if ((data.watches || []).some((w) => w.id === watch.id)) {
      return jsonResponse({ error: `id "${watch.id}" 已經存在,換一個名字` }, 409);
    }
    data.watches = [...(data.watches || []), watch];
    await putWatchesFile(context.env, data, sha, `chore(watches): add ${watch.id} via web UI`);
    return jsonResponse(watch, 201);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
