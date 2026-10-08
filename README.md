# @dsh-external/dsh-plugin-image-gen

把一条提示词变成图片的 DSH 工具插件。

**生图路径**：`prompt`（英文、尽量具体）→ 整体 URL 编码 → 拼到 pollinations 生图接口
→ 取回字节 → 存入 `attachments`（拿到 `sha256` 附件引用）→ 以真正的图片块显示。

由 `dsh-super-injector` 的 `dev_scaffold_plugin` 生成骨架，实现按本仓库需要重写。

---

## 安装

```bash
# 从 GitHub 装（推荐）
dsh plugin --profile web add github:jxboop/dsh-plugin-image-gen

# 或者从本地目录（改代码时用）
dsh plugin --profile web add <本仓库的绝对路径>
```

装完**重启 DSH**，新会话里就有 `image_generate` 工具了。

验证：随便开一个会话，直接说「用 image_generate 生成一张图」，能出图就是装好了。

> **手机桥用户注意**：手机界面工具栏上的「生图」键**就是调这个工具**（它本身不直连生图后端，
> 只是把「请用 image_generate 生成一张图片…」这句话交给会话）。
> 没装这个插件时，agent 只会回一句"没有这个工具 / 没有生图模型" ——
> 那不是手机桥坏了，是这台电脑缺这个插件。
>
> 环境要求：Node 22+；DSH 版本与 peer 依赖见 `package.json`。
> 仓库里带了构建产物 `lib/`，装完即可用，**不需要**在本地再编译。

---

## 工具契约

工具名：`image_generate`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | ✓ | 英文提示词。工具**只做 URL 编码，不改写**——完善描述由模型（会话里的我）负责 |
| `width` / `height` | integer | | 默认取插件配置（1920×1080） |
| `model` | string | | 如 `flux` / `turbo`，默认取配置（`flux`） |
| `seed` | integer | | 固定种子以便复现同一张图 |
| `attach` | boolean | | 是否取回图片并作为附件显示，默认 `true` |

返回值（同时用于渲染）：

- 文本块：`![image](url)` + `<url>` / `<model>` / `<size>` 元信息
- 图片块：`{ type: 'image', attachment: <ImageAttachmentRef> }`（当 `attach !== false`）

### 为什么落附件而不是只回 markdown

markdown 图片能不能渲染取决于 GUI 渲染器与 CSP；**附件是 DSH 原生图片通路**
（内置 `read_image` 走的就是它），`{ type: 'image', attachment }` 一定能显示。
所以两条路都给：markdown 用于文本场景/复制直链，图片块用于 GUI 内显示。

### 关于 token 成本与文本模型

图片块会随请求送进模型上下文（也就是我会"看到"这张图，1920×1080 有实际成本）。
不需要我看图时传 `attach: false`，就只回 markdown + 直链、不取字节。

对不支持图片输入的模型，请求装配会走 `dsh-llm` 的 `projectImagesForTextModel`
把它投影成文本句柄，**不会报错**，GUI 仍从会话日志渲染附件。

---

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `providers` | `['pollinations','huggingface']` | 后端顺序，按序尝试。可填 `together` / `huggingface` / `pollinations` |
| `endpoint` | `https://image.pollinations.ai/prompt/` | pollinations 接口前缀，prompt 以 URL 编码追加其后 |
| `model` | `flux` | pollinations 模型 |
| `width` / `height` | 1024 / 1024 | 默认尺寸（等于上游默认值；默认尺寸下**不写进 URL**，见下） |
| `enhance` | `false` | 接口侧提示词增强。**默认关**：匿名档带它会 402 |
| `private` | `false` | 隐藏到公共 feed。**默认关**：匿名档带它会 402 |
| `nologo` | `true` | 去水印 |
| `safe` | `false` | 严格 NSFW 过滤。**默认关**：匿名档带它会 402 |
| `token` | `''` | pollinations token（`auth.pollinations.ai` 免费注册） |
| `attach` | `true` | 默认是否取回并落为附件 |
| `huggingface.space` | `black-forest-labs/FLUX.1-schnell` | HF Space 后端 |
| `huggingface.steps` | 4 | FLUX.1-schnell 只支持 1–8 步 |
| `together.key` | `''` | **Together.ai 免费 key（最稳的路，见下）** |
| `together.baseUrl` | `https://api.together.xyz/v1` | OpenAI 兼容端点 |
| `together.model` | `black-forest-labs/FLUX.1-schnell-Free` | 官方标注免费无限量 |
| `timeoutMs` | 60000 | 单次取图超时 |

---

## ⚠️ 2026-10 上游现状与"取图失败"的最短恢复路径

**症状**：调用 `image_generate` 报 `取图失败，N 个后端均未成`，明细里是
`HTTP 402` / `HTTP 500`（500 的响应体里其实是 `Gen Sana request failed with 402:
Insufficient balance ... pollen`）。

**原因（实测结论，不是本插件逻辑问题）**：

1. **插件默认 URL 踩了付费面**：pollinations 把 `enhance=true`、`private=true`、
   `safe=true`、**显式 width/height**、以及 `sana`/`turbo` 等模型划进了付费判定，
   匿名请求带这些参数直接 402。原来的默认值恰好全中，所以"一装上就跑不起来"。
   → 已改为：默认只发 `?model=flux&nologo=true`（实测唯一稳定出图的形态），
   关闭的布尔与默认尺寸**不写进 URL**。
2. **上游免费池余额枯竭**：同一极简 URL 在 20s 间隔下反复打点，仍会在
   `200 / 402 / 500` 之间跳变，错误体明写 `Insufficient balance`。
   即 pollinations 自己的免费账户没余额了——**这一层客户端无法修复**。
3. **HF Space 的匿名 GPU 配额也会耗尽**：非 GPU 的 Gradio Space 正常，
   但 FLUX/图像类 Space 会对匿名请求回 `event: error`。
4. **不要用"多档位快速重试"**：匿名档限流约 15s/条，几秒内连打多档只会让每条都吃 402
   （实测 4 档阶梯全灭、单发极简稳定 200）。所以阶梯现在只留 2 档、重试间隔 16s。

**恢复可用（推荐，一次配置永久生效）**：

```yaml
# <dshHome>/settings.yaml —— 或直接在设置页插件卡片里填
dsh-plugin-image-gen:
  providers: [together]          # 用带 key 的后端，最稳
  together:
    key: <你的 Together.ai key>   # https://api.together.xyz 免费注册
```

Together.ai 的 `black-forest-labs/FLUX.1-schnell-Free` 官方标注免费无限量，
注册即得，出图约 1–3s。**或者**给 pollinations 免费注册一个 token
（`auth.pollinations.ai`，Seed 档 5s/条）填 `token` 字段，也能显著提升可用性。

不想注册任何东西时：保持默认配置，但要知道匿名档随时可能因上游余额而整体不可用，
且必须**约 15s 才能出一张**，连续调用会被限流。

---


## 构建

### 常规（有 dsh 源码 checkout）

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
```

### 只有 npm 安装包时（本机情形）

脚手架假设存在源码 checkout（`$CHECKOUT/packages/...`、`vendor/`、`$CHECKOUT/node_modules/.bin/tsc`）。
本机只有 npx 缓存布局的安装包，因此：

```bash
node scripts/link-deps.mjs      # 把编译需要的 @deepseek-ai/* junction 到本插件 node_modules
tsc -p tsconfig.json            # 用现代 tsc（TypeScript 7）；本机在 dsh-market 的 node_modules 里
```

或一条命令：`npm run build:local`

> 注意：全局 `tsc` 是 TypeScript 2 时代的老版本，不认 `target: es2023` / `module: NodeNext`，
> 会刷出成百条 `@types/node` 语法错误。请用现代 tsc。

### 冒烟测试

```bash
node scripts/smoke.mjs ["英文提示词"]
```

在假 ctx 上驱动构建产物 `lib/index.js`，跑通：工具注册 → schema 形态 → URL 编码 →
**真实网络取图** → 落附件（桩）→ render 双内容块 → `attach:false` 分支。

---

## 注入 / 卸载

```bash
# 注入器环境内
dev_inject_plugin   D:\learn\deepseek学习\dsh-plugin-image-gen
dev_uninject_plugin dsh-plugin-image-gen
```

注入后工具在**下一轮请求**才出现在模型工具表里（当前轮的 schema 已发出）。

---

## 已知边界

- **三个后端都不保证永远可用**：pollinations 免费池会出现 `Insufficient balance`（实测 2026-10）、
  HF Space 的匿名 GPU 配额会耗尽、Together 免费档按请求限速。工具会按 `providers`
  顺序逐个尝试并把每家失败原因写进报错，不影响会话。
- **匿名 pollinations 约 15s 只能出一张**，连续调用必被限流；要稳定出图请配 key（见上）。
- 生成图不含 alpha 通道（上游 VAE 是 RGB），需要透明背景要另做抠图。
- 没有实现 negative prompt、参考图（img2img）、批量出图——需要时加参数即可。
- 接口返回的 `content-type` 必须是 attachments 接受的四种之一（png/jpeg/webp/gif），
  否则工具直接拒绝，不会塞给附件服务。
- `lib/` 是编译产物但**入库**（`files: ["lib"]`），因此无需在目标机装 TypeScript 也能加载。
- `npm run smoke` 会**真实联网取图**，所以上游不可用时它会失败——这属于上游状态，
  不代表产物坏了；可先用 `node --check lib/index.js` 或 `npm run typecheck` 验证代码本身。
