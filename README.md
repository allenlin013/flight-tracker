# FTPT — 航班價格追蹤

個人用的航班比價/追蹤/歷史價格面板小工具。用 [fast-flights](https://github.com/AWeirdDev/flights)(Google Flights 的非官方爬蟲套件)查即時價格,GitHub Actions 排程執行,價格歷史直接存成 repo 內的 JSON 檔(不用額外資料庫),Cloudflare Pages 部署靜態面板顯示走勢圖,優惠出現時發 Discord 通知。

## 功能

1. **即時查詢**:「⚡ 即時查詢」頁面輸入出發/抵達機場、日期,幾秒內看到現在的真實價格(單程/來回),滿意的話一鍵加入追蹤清單。
2. **監控行程**:「⚙️ 管理監控清單」新增/編輯/刪除要長期追蹤的航班 —— 支援來回/單程(固定日期、日期區間、或整個月份掃描),以及多城市多航段行程(如 A→B→C→A)。設定存在 `config/watches.json`,由網頁透過 GitHub API 自動 commit,不用手動編輯或 git push。
3. **價格追蹤 + 通知**:排程定期查價、累積歷史,價格低於你設的門檻、或比歷史最低價再低一個百分比時,發 Discord 通知。
4. **歷史價格面板**:網頁顯示每個監控項目的價格走勢折線圖、優惠徽章、搜尋/排序與原始紀錄。

## 架構

```
docs/search.html(即時查詢)──呼叫──> live-search/api/search.py (Vercel,獨立部署)
                                        → 用 fast_flights 即時查一次,幾秒內回傳排序好的結果

docs/manage.html(管理清單) ──呼叫──> functions/api/watches/*  (Cloudflare Pages Functions)
                                              │
                                              ▼
                          GitHub Contents API:讀/寫 config/watches.json(自動 commit)

GitHub Actions(cron)→ scripts/fetch_prices.py → 讀 config/watches.json → 查 fast-flights
                                                → 寫入 docs/data/*.jsonl + summary.json
                                                → 判斷優惠 → Discord Webhook 通知
                                                → git commit + push 回 repo

Cloudflare Pages(綁定這個 repo,build 目錄設為 docs/)
  → 自動部署 docs/index.html(面板)+ docs/manage.html(管理清單)+ docs/search.html(即時查詢)+ functions/(API)
```

`functions/` 目錄放在 repo 根目錄(跟 `docs/` 同層),這是 Cloudflare Pages Functions 的硬性規定。`live-search/` 是另一個獨立的 Vercel 專案(不同平台,因為 Cloudflare 的 Python runtime 是 WASM 沙盒,跑不了 `fast-flights` 依賴的原生擴充套件 `primp`)。

## 建置步驟

### 1. 建立 Discord Webhook

Discord 頻道 → 編輯頻道 → 整合(Integrations)→ Webhook → 新增 Webhook → 複製 URL。

### 2. 建立 GitHub repo 並設定 Secret

```bash
cd FTPT
git init
git add .
git commit -m "init"
gh repo create <your-repo-name> --private --source=. --push
```

到 repo 的 Settings → Secrets and variables → Actions,新增 Secret:

- `DISCORD_WEBHOOK_URL`:剛剛複製的 Discord Webhook URL

### 3. 建立 GitHub Fine-grained Personal Access Token(給管理清單的網頁 API 用)

到 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token:

- Repository access:只勾選這個 repo(不要選 All repositories)
- Permissions → Repository permissions → **Contents: Read and write**(其他都不用給)

產生後複製 token,先存起來,下一步會用到。

### 4. 綁定 Cloudflare Pages

1. 到 [Cloudflare Pages](https://pages.cloudflare.com/) 建立新專案,連結這個 GitHub repo(私有 repo 也可以)。
2. Build 設定:Framework preset 選 `None`,Build command 留空,**Build output directory 填 `docs`**。(`functions/` 資料夾 Cloudflare 會自動偵測,不用額外設定 build 指令。)
3. 部署完成後會拿到一個 `*.pages.dev` 網址,就是你的面板。
4. 到這個 Pages 專案的 Settings → Environment variables,新增以下變數(**Production** 環境;建議都用 Secret 加密):
   - `GITHUB_TOKEN`:第 3 步產生的 fine-grained PAT
   - `GITHUB_OWNER`:你的 GitHub 帳號名稱
   - `GITHUB_REPO`:repo 名稱
   - `GITHUB_BRANCH`:通常是 `main`
5. **這一步是必要的,不是選配**:到 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) 設定 Access,把整個 Pages 網域(包含免費的 `*.pages.dev`,這個網域要另外在 Zero Trust 的設定裡「啟用」,跟綁自訂網域是分開的開關)設成需要登入才能看。因為現在網頁背後接了一支能改你 repo 內容的 API,沒設這一步等於任何人拿到網址都能亂改你的監控清單、甚至濫用那組 GitHub token 的寫入權限。

### 5. 部署「即時查詢」用的 Vercel 專案

1. 到 [Vercel](https://vercel.com/) 註冊(免信用卡),New Project → Import 這個 GitHub repo。
2. **Root Directory 設定為 `live-search`**(這是關鍵,不然 Vercel 會從 repo 根目錄找,找不到 `api/`)。
3. Environment Variables 設定:
   - `ALLOWED_ORIGIN`:你的 Cloudflare Pages 網址(例如 `https://xxx.pages.dev`),限制只有這個來源能呼叫,避免別人路過亂打你的免費額度。
   - `SEARCH_API_KEY`:自己取一組亂數字串(例如用 `openssl rand -hex 16` 產生),等一下前端也要填同一組。
4. 部署完會拿到一個 `https://xxx.vercel.app` 網址。
5. 打開 `docs/search.js`,把檔案最上面的 `SEARCH_API_URL` 換成 `https://xxx.vercel.app/api/search`、`SEARCH_API_KEY` 換成第 3 步設定的同一組字串,`git add` / `commit` / `push`(Cloudflare Pages 會自動重新部署,面板這邊不用動 Vercel 的設定)。

### 6. 打開「管理監控清單」新增你要長期追蹤的行程

開啟 `https://<你的網址>/manage.html`,用表單新增你實際想追蹤的行程,或是從「⚡ 即時查詢」查到喜歡的結果後直接按「加入追蹤清單」。存檔後會自動在 GitHub repo 產生一個 commit,`config/watches.json` 就會更新。

### 7. 手動觸發一次排程測試

到 GitHub repo 的 Actions 分頁,選 `Track Flight Prices` → `Run workflow` 手動跑一次,確認:

- 有正常查到價格(看 workflow log)
- `docs/data/` 底下有新的 `.jsonl` 檔跟更新過的 `summary.json` 被 commit 回來
- Cloudflare Pages 自動重新部署,面板打得開且有資料

之後就會照 `.github/workflows/track-prices.yml` 裡設定的頻率(預設每 6 小時)自動執行。

## 本機測試

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
DISCORD_WEBHOOK_URL="<你的webhook,測試用,可留空跳過通知>" python scripts/fetch_prices.py
```

跑完後打開 `docs/index.html`(建議用 `python -m http.server` 在 `docs/` 目錄下起個簡易伺服器,直接雙擊開檔案 `fetch` 本地檔案可能會被瀏覽器擋掉)確認圖表正常。

`docs/manage.html` 的新增/編輯/刪除功能是靠 Cloudflare Pages Functions(`/api/watches`)運作,本機用 `python -m http.server` 只能看到表單畫面,API 呼叫一定會失敗 —— 這是預期行為,要部署到 Cloudflare Pages 之後才測得出來(或用 `npx wrangler pages dev docs` 在本機模擬,需要另外設定環境變數)。

`docs/search.html` 的查詢功能同理要部署到 Vercel 才能用。但 `live-search/api/search.py` 的核心邏輯可以直接在本機驗證(不需要 Vercel runtime):

```bash
cd live-search
pip install -r requirements.txt
python -c "
import sys; sys.path.insert(0, 'api')
import search
client = search.app.test_client()
r = client.post('/api/search', json={'trip': 'round_trip', 'from': 'TPE', 'to': 'NRT', 'depart_date': '2026-11-10', 'return_date': '2026-11-15'})
print(r.status_code, r.get_json())
"
```

## 已知限制

- `fast-flights` 是逆向工程套件,依賴 Google Flights 網頁/API 的內部格式,對方改版可能導致查詢失效或需要更新套件版本。僅供個人使用,請勿公開分享此工具或大幅提高查詢頻率,以免造成濫用疑慮。
- **實測發現的套件 bug**:目前版本(3.1.0)的解析器對某些特定航線會直接拋出 `IndexError`,已確認 **ICN↔NRT**(首爾仁川↔東京成田,不論方向或日期)必定失敗 —— 不是沒有航班,是套件內部解析回傳資料的邏輯跟這條航線回傳的格式對不上。單一查詢失敗只會在 log 印警告、略過該筆,不會讓整個排程掛掉,但那個監控項目那次就拿不到資料。**新增監控項目前,建議先手動測一次那條航線**,確認不會一直失敗;若真的用得到某條容易壞的航線,可以先試附近的機場(如 NRT 換 HND)繞過。
- 「多停點」支援兩種形式:①`multi_city` —— 多段分開的航班(如 TPE→ICN→HND→TPE),每段日期固定;②單一航段內含轉機 —— 一般的 one_way/round_trip 查詢預設就會回傳含轉機的選項,不需額外設定,轉機城市由 Google Flights 自行安排。
  - `multi_city` 若超過 2 段,套件的原生多城市查詢一律會壞掉(另一個已知 bug,跟上面航線無關,3 段以上必定失敗),所以程式會自動改成「每段各自查單程價格再相加」來估算總價,並在 `query_desc` 標註「估計:分段單程相加,非聯程票價」。這是估計值,通常會比實際聯程票價貴一些,但足以拿來追蹤趨勢。
- `date_mode: range` / `month` 在候選日期很多時,每次執行只會依 `max_candidates_per_run` 取一批(輪替取樣),不會一次全部查完,是刻意的設計以避免對 Google 送出過量請求。
- 價格與歷史紀錄是從你設定監控的那一刻開始累積,不是回溯性的歷史資料。
- **管理清單的寫入是靠 GitHub Contents API**:每次在 `manage.html` 新增/編輯/刪除,都會在 repo 產生一個 git commit(這是刻意設計,順便當操作紀錄),存檔會有 1-2 秒的延遲。沒有多人協作鎖定機制,單人使用沒問題,若真的同時開兩個分頁編輯,後存的會覆蓋先存的。
- **這個管理介面背後有一組能寫入你 repo 的 GitHub token**,務必照建置步驟第 5 點設定 Cloudflare Access,否則任何拿到網址的人都能亂改監控清單甚至濫用該 token 的權限。
- **即時查詢(`search.html`)目前只支援 one_way / round_trip 的單一確切日期**,不支援 range/month 掃描或 multi_city —— 這些比較適合交給排程追蹤,不是「查一次看現在價格」的用例。
- 即時查詢是另一個獨立服務(Vercel),表示整個工具現在要維護三個外部帳號:GitHub、Cloudflare、Vercel。免費方案偶爾會有幾秒冷啟動,屬正常現象。
- `search.js` 裡的 `SEARCH_API_KEY` 寫在前端程式碼中,技術上看得到,只是拉高隨便掃描的門檻,不是真正的身份驗證 —— 這個端點本身只能查價、沒有寫入能力,風險本來就低,但不要把這組 key 當成機密來看待。
