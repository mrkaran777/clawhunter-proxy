# 🐾 Claw Hunter Free Image Gen / 免費圖片生成

OpenAI Compatible API Proxy with Web UI, deployed on Cloudflare Workers.  
帶 Web UI 的 OpenAI 相容圖片生成 API 代理，部署到 Cloudflare Workers。

> **Free forever** — 3 AI models, unlimited relay rotation, no credit card required.  
> **永久免費** — 3 個 AI 模型，無限代理輪詢，無需信用卡。

---

## ✨ Features / 功能

### Core / 核心功能
- ✅ **Web UI** — Generate images directly in browser / 瀏覽器直接生成圖片
- ✅ **OpenAI Compatible API** — Drop-in replacement for OpenAI SDK / 完全相容 OpenAI SDK
- ✅ **Text-to-Image** — Describe what you want / 文生圖
- ✅ **Image-to-Image** — Upload reference image for edit / 圖生圖（上傳參考圖片）
- ✅ **3 Free Models** — All completely free / 3 個完全免費模型

### UI / 界面
- ✅ **Drag & Drop** — Drag images to upload / 拖拽上傳圖片
- ✅ **Image Zoom (Lightbox)** — Click to enlarge full-screen / 點擊全屏放大
- ✅ **Aspect Ratio** — 1:1, 16:9, 9:16, 4:3, 3:4 / 選擇寬高比
- ✅ **Quality Control** — Low, Medium, High / 品質控制
- ✅ **Dark Theme** — Modern dark UI / 現代暗色主題
- ✅ **Keyboard Shortcuts** — Ctrl+Enter to generate / Ctrl+Enter 快速生成

### Infrastructure / 基礎設施
- ✅ **IP Rotation** — Multi-platform relay for unlimited quota / 多平台代理輪詢
- ✅ **Free Platform Relays** — Vercel + Deno + Netlify (all free) / 免費平台中轉
- ✅ **Token Pool** — Auto-refresh with retry on rate limit / 自動刷新 Token
- ✅ **Global CDN** — CF Workers 200+ edge nodes / 全球 200+ 邊緣節點
- ✅ **Auto Retry** — Exponential backoff on rate limit / 限流自動重試

---

## 📋 Supported Models / 支持的模型

| Model | Provider | Text-to-Image | Image-to-Image | Free Tier |
|---|---|---|---|---|
| `gpt-image-2` | OpenAI | ✅ | ✅ | **FREE** (1K daily) |
| `nano-banana-2` | Google | ✅ | ✅ | **FREE** (1K daily) |
| `kling-v3` | Kuaishou | ✅ | ❌ | **FREE** (daily limit) |

> 所有模型均支持訪客免費層，每日有免費額度限制。  
> All models support free visitor tier with daily limits.

---

## 🚀 Quick Deploy / 快速部署

### Method 1: One-Click Deploy / 一鍵部署

```bash
# 1. Install Wrangler CLI / 安裝 Wrangler CLI
npm install -g wrangler

# 2. Login to Cloudflare / 登入 Cloudflare
npx wrangler login

# 3. Deploy / 部署
cd clawhunter-proxy
npm install
npx wrangler deploy
```

Your Worker URL: `https://clawhunter-proxy.YOUR-SUBDOMAIN.workers.dev`

### Method 2: Deploy with IP Rotation / 部署 + IP 輪詢

```bash
# Deploy main Worker + all free platform relays / 部署主 Worker + 所有免費平台 relay
./deploy-relays.sh all

# Get RELAY_URLS configuration / 獲取 relay 配置
./deploy-relays.sh config

# Set relay URLs on main Worker / 設置 relay URLs
npx wrangler secret put RELAY_URLS

# Deploy / 部署
npx wrangler deploy
```

---

## 📖 Usage / 使用方法

### Web UI / 網頁界面

Visit your Worker URL directly:  
直接訪問 Worker URL:

```
https://clawhunter-proxy.YOUR-SUBDOMAIN.workers.dev
```

1. Enter prompt / 輸入提示詞
2. Select model / 選擇模型
3. Choose aspect ratio / 選擇寬高比
4. Choose quality / 選擇品質
5. (Optional) Upload reference image / （可選）上傳參考圖片
6. Click Generate / 點擊生成
7. **Click image to zoom** / **點擊圖片放大**

### Image Upload / 圖片上傳

| Method | Description |
|---|---|
| **Click** | Click upload zone to select file / 點擊上傳區域選擇文件 |
| **Drag & Drop** | Drag images onto the zone / 拖拽圖片到上傳區域 |
| **Formats** | PNG, JPEG, WebP |
| **Max Size** | 10MB per image / 每張最大 10MB |
| **Max Images** | 4 reference images / 最多 4 張參考圖片 |

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://clawhunter-proxy.YOUR-SUBDOMAIN.workers.dev/v1",
    api_key="your-key"
)

# Text-to-Image / 文生圖
response = client.images.generate(
    model="gpt-image-2",
    prompt="A cute orange cat sitting on a windowsill",
    n=1
)
print(response.data[0].url)

# Image-to-Image / 圖生圖
import base64
with open("input.png", "rb") as f:
    img_b64 = "data:image/png;base64," + base64.b64encode(f.read()).decode()

response = client.images.generate(
    model="gpt-image-2",
    prompt="Add sunglasses to the cat",
    n=1,
    extra_body={"image": img_b64}
)
print(response.data[0].url)

# With aspect ratio / 指定比例
response = client.images.generate(
    model="gpt-image-2",
    prompt="A wide landscape",
    n=1,
    extra_body={"aspect_ratio": "16:9"}
)
print(response.data[0].url)
```

### Node.js

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://clawhunter-proxy.YOUR-SUBDOMAIN.workers.dev/v1',
  apiKey: 'your-key'
});

// Text-to-Image / 文生圖
const response = await client.images.generate({
  model: 'gpt-image-2',
  prompt: 'A cute orange cat',
  n: 1
});
console.log(response.data[0].url);

// Image-to-Image / 圖生圖
const fs = require('fs');
const imgB64 = 'data:image/png;base64,' + fs.readFileSync('input.png').toString('base64');

const edit = await client.images.generate({
  model: 'gpt-image-2',
  prompt: 'Add sunglasses',
  n: 1,
  extra_body: { image: imgB64 }
});
console.log(edit.data[0].url);

// With aspect ratio / 指定比例
const wide = await client.images.generate({
  model: 'gpt-image-2',
  prompt: 'A wide landscape',
  n: 1,
  extra_body: { aspect_ratio: '16:9' }
});
console.log(wide.data[0].url);
```

### curl

```bash
# Text-to-Image / 文生圖
curl -X POST https://clawhunter-proxy.YOUR-SUBDOMAIN.workers.dev/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "A cute orange cat",
    "n": 1,
    "aspect_ratio": "1:1"
  }'

# Image-to-Image / 圖生圖
curl -X POST https://clawhunter-proxy.YOUR-SUBDOMAIN.workers.dev/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "Add sunglasses",
    "n": 1,
    "image": "data:image/png;base64,...BASE64_DATA..."
  }'

# 16:9 Widescreen / 寬屏
curl -X POST https://clawhunter-proxy.YOUR-SUBDOMAIN.workers.dev/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nano-banana-2",
    "prompt": "A sunset over the ocean",
    "n": 1,
    "aspect_ratio": "16:9",
    "resolution": "1K"
  }'
```

### Batch Generation / 批量生成

```python
# Use batch_generate.py for bulk image creation / 使用批量生成腳本
python3 batch_generate.py \
  -p "a cute cat" "a dog running" "a sunset" \
  -m gpt-image-2 \
  -o ./output \
  --quality medium

# From file / 從文件讀取 prompts
python3 batch_generate.py -f prompts.txt -m nano-banana-2
```

---

## 📊 API Reference / API 參考

### Endpoints / 端點

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Web UI / 網頁界面 |
| `GET` | `/app.js` | Client-side JavaScript |
| `GET` | `/health` | Health check + relay status / 健康檢查 |
| `GET` | `/v1/models` | List available models / 模型列表 |
| `POST` | `/v1/images/generations` | Generate image / 圖片生成 |
| `POST` | `/admin/refresh-tokens` | Refresh token pool / 刷新 Token 池 |

### Request Parameters / 請求參數

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | string | `gpt-image-2` | Model ID / 模型 ID |
| `prompt` | string | **required** | Image description / 圖片描述 |
| `n` | int | `1` | Number of images (1-4) / 圖片數量 |
| `quality` | string | `medium` | `low`, `medium`, `high` |
| `aspect_ratio` | string | `1:1` | `1:1`, `16:9`, `9:16`, `4:3`, `3:4` |
| `resolution` | string | `1K` | `1K`, `2K` (required for aspect_ratio) |
| `image` | string | — | Base64 data URL for editing / 圖片編輯 |
| `input_images` | string[] | — | Multiple reference images / 多張參考圖 |

### Response Headers / 回應標頭

| Header | Description |
|---|---|
| `X-Claw-Model` | Actual model used / 實際使用的模型 |
| `X-Claw-Cost` | Cost in USD / 費用 (USD) |
| `X-Claw-Note` | Additional info / 附加信息 |
| `X-Claw-Edge` | Request source: `direct` or `relay-N` / 請求來源 |

### Health Response / 健康檢查回應

```json
{
  "status": "ok",
  "token_pool": 3,
  "relays": 4,
  "platforms": ["vercel", "deno", "netlify", "cf-worker"],
  "edge_nodes": "direct + 4 relays",
  "models": ["gpt-image-2", "nano-banana-2", "kling-v3"]
}
```

---

## 🔄 How It Works / 工作原理

```
User Request → Web UI or API Client
    ↓
CF Worker (your-worker.workers.dev)
    ↓
Phase 1: Direct → clawhunter.fun
    ↓ (if 429 daily limit)
Phase 2: Relay rotation
    ├→ Relay 1 (Vercel Edge)   → clawhunter.fun ✅
    ├→ Relay 2 (Deno Deploy)   → clawhunter.fun ✅
    ├→ Relay 3 (Netlify Edge)  → clawhunter.fun ✅
    └→ Relay 4 (CF Account 2)  → clawhunter.fun ✅
    ↓
Return Result (base64 or URL)
```

### Token Pool / Token 池

- Pool of 3 tokens, auto-refreshed / 3 個 Token 自動輪換
- Proactive refill when pool < 2 / 池不足時自動補充
- Serial fetching to minimize subrequests / 串行刷新減少子請求

### Retry Strategy / 重試策略

- **Phase 1**: 3 direct attempts with fresh tokens / 3 次直連重試
- **Phase 2**: Rotate through all relays / 輪詢所有 relay
- Daily limit detection: stops early if quota exhausted / 偵測每日配額用完
- 25s timeout per relay to prevent hanging / 每個 relay 25 秒超時

### IP Rotation / IP 輪詢

- CF Workers: 200+ edge nodes, different IPs per region / 不同區域不同 IP
- Vercel Edge: 30+ edge locations / 30+ 邊緣位置
- Deno Deploy: 35+ regions / 35+ 區域
- Netlify Edge: 10+ edge locations / 10+ 邊緣位置
- Each platform = independent daily quota / 每個平台 = 獨立每日額度

---

## 🎨 UI Features / 界面功能

| Feature | Description |
|---|---|
| **Lightbox** | Click any image to zoom full-screen / 點擊圖片全屏放大 |
| **Drag & Drop** | Drag images to upload zone / 拖拽圖片上傳 |
| **Model Selector** | Switch between 3 free models / 切換 3 個免費模型 |
| **Aspect Ratio** | 1:1, 16:9, 9:16, 4:3, 3:4 / 選擇寬高比 |
| **Quality** | Low, Medium, High / 選擇品質 |
| **Status Bar** | Shows cost, model, and edge info / 顯示價格、模型和節點信息 |
| **Keyboard** | Ctrl+Enter to generate, ESC to close zoom / Ctrl+Enter 生成，ESC 關閉放大 |
| **Error Messages** | Shows specific upstream errors + reset time / 顯示具體錯誤和重置時間 |

---

## ⚠️ Notes / 注意事項

| Item | Description |
|---|---|
| **Free Tier** | Claw Hunter has daily free limits per IP / 每 IP 每日免費額度有限 |
| **CF Workers Free** | 100K requests/day / 免費版 10 萬次/天 |
| **Token Expiry** | Auto-maintained, ~12h validity / 自動維護，~12 小時有效 |
| **Image Size** | Results may be 100KB–3MB / 返回圖片可能較大 |
| **Upload Limit** | Max 10MB per image, max 4 reference images / 每張最大 10MB，最多 4 張 |
| **Resolution** | Must send `resolution: "1K"` with `aspect_ratio` / 發送比例時需附帶解析度 |
| **Rate Limit** | Auto-retry + relay rotation / 自動重試 + 代理輪詢 |
| **IP Rotation** | Deploy relays for more quota / 部署 relay 增加額度 |

---

## 📁 Project Structure / 項目結構

```
clawhunter-proxy/
├── src/
│   └── index.js          # Main Worker (680 lines)
│                          # HTML/CSS/JS + API proxy + relay rotation
├── relay.js               # CF Worker relay template (94 lines)
├── relays/
│   ├── vercel/
│   │   └── api/relay.js   # Vercel Edge Function relay
│   ├── deno/
│   │   └── deploy.ts      # Deno Deploy relay
│   └── netlify/
│       └── edge-functions/
│           └── relay.js   # Netlify Edge Function relay
├── deploy-relays.sh       # One-click deploy to all platforms (370 lines)
├── deploy-multi.sh        # Multi CF account deploy (330 lines)
├── batch_generate.py      # Batch generation script
├── wrangler.toml          # CF Workers config
├── wrangler-relay.toml    # Relay Worker config template
├── package.json           # Dependencies
├── deploy.sh              # Basic deploy script
└── README.md              # This file
```

---

## 🛠️ Development / 開發

```bash
# Local development / 本地開發
npx wrangler dev

# Deploy / 部署
npx wrangler deploy

# View logs / 查看日誌
npx wrangler tail

# Deploy relay to Vercel / 部署 relay 到 Vercel
cd relays/vercel && vercel deploy --prod

# Deploy relay to Deno / 部署 relay 到 Deno
cd relays/deno && deployctl deploy --project=claw-relay deploy.ts
```

---

## 📄 License / 授權

MIT
