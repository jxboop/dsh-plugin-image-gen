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

> **装完发现"还是没有这个工具"？** 说明这个包只是被当依赖装下来了，没有进 profile 的装配列表。
> 打开 `~/.dsh/profiles/<你的 profile>/package.json`，在 `dsh.profile.bundles` 里加上一行
> `"@dsh-external/dsh-plugin-image-gen"`，再重启 DSH。（本包已声明 `dsh.bundle.patch`，
> 正常情况下不需要这一步。）

> **手机桥用户注意**：手机界面工具栏上的「生图」键**就是调这个工具**（它本身不直连生图后端，
> 只是把「请用 image_generate 生成一张图片…」这句话交给会话）。
> 没装这个插件时，agent 只会回一句"没有这个工具 / 没有生图模型" ——
> 那不是手机桥坏了，是这台电脑缺这个插件。
>
> 环境要求：Node 22+；DSH 版本与 peer 依赖见 `package.json`。
> 仓库里带了构建产物 `lib/`，装完即可用，**不需要**在本地再编译。

---

## 配置：改一个 JSON 文件就行（不用碰 YAML、不用重启）

插件会读 **`~/.dsh/image-gen.json`**（Windows：`C:\Users\<你>\.dsh\image-gen.json`）。
**第一次生图时自动生成一份模板**，打开就能看到该填什么：

```json
{
  "providers": ["pollinations", "huggingface"],
  "together": { "key": "" },
  "token": "",
  "model": "flux"
}
```

**改完下一次生图就生效**（每次调用都读一遍，不用重启、不用重载插件）。规则：

- 这里的键**优先于**组合配置（`cordis.patch.yml`）；不写就用默认值。
- 支持：`endpoint` `width` `height` `model` `enhance` `private` `nologo` `token` `providers`
  `huggingface` `together` `zhipu` `attach` `timeoutMs`
  （`toolTimeoutMs` 只能在组合里改 —— 工具超时必须注册时就定下来）。
- 嵌套的 `together` / `huggingface` 做**浅合并**：只写 `together.key` 就够，不必把 `baseUrl` / `model` 抄一遍。
- 写坏了不会崩：那次生成按默认配置走，并在结果里回一句话告诉你哪儿不对
  （"不是合法 JSON""有不认识的键"…）。

### 四条路怎么选（按你的网络）

| 你的情况 | 建议 |
|---|---|
| **国内、想稳定**（推荐） | 去 <https://bigmodel.cn/usercenter/proj-mgmt/apikeys> **免费注册拿 key**（送额度，`cogview-3-flash` **免费**）→ key 填 `zhipu.key`，`providers` 改成 `["zhipu"]`。**不用加速器**（`open.bigmodel.cn` 国内直连，实测 401 = 通） |
| 国内、不想注册 | **保持默认**：`providers: ["pollinations","huggingface"]`。pollinations 国内可直连；HF 通常连不上，但插件会**探一下、不通就跳过**（不会白等） |
| 想再稳一点（不注册智谱） | 去 <https://gen.pollinations.ai> 免费注册拿 token，填进 `token` |
| 有加速器 / 在海外 | 去 <https://api.together.xyz> 免费注册拿 key，填 `together.key`，`providers` 改成 `["together"]`（最快，1–3 秒出图）。⚠️ 它的 API 域名在国内**被 Cloudflare 按 IP 挡**（带 key 也是 403），必须挂着加速器用 |

> 高级做法：也可以直接改组合配置里的装配行（`~/.dsh/profiles/<你的 profile>/cordis.patch.yml`）：
>
> ```yaml
> - insert:
>     - id: image-gen
>       name: '@dsh-external/dsh-plugin-image-gen'
>       config:
>         providers: ['together']
>         together:
>           key: <你的 key>
> ```
>
> 改完要重启 DSH。**本地 JSON 文件优先于它**，所以平时建议只维护那个文件。

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

## 工具契约：`video_generate`（1.4.0 起）

把一句提示词变成一段视频。**免费**（智谱 CogVideoX 的 `cogvideox-flash`），
和生图共用同一份智谱 key。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | ✓ | 视频描述，中英文都行：主体、动作、镜头运动、风格 |
| `size` | string | | 分辨率，默认取配置（`1920x1080`；横屏 1280x720 / 竖屏 1080x1920 也行） |
| `fps` | integer | | 帧率，默认 30 |
| `model` | string | | `cogvideox-flash`（默认，**免费**，带智谱水印）/ `cogvideox-3`（更清晰、可带音频，按量计费） |
| `imageUrl` | string | | 图生视频：**公网可访问**的图片 URL（智谱取不到本机文件，所以只收 URL） |

返回 `{ path, url, model, size, bytes, seconds, coverUrl?, note? }`，
其中 **`path` 是落在电脑上的 mp4 绝对路径**：手机桥看到文本里的 `.mp4` 路径会把它显示成
**能直接播放的视频**（长按可存相册）。

### 为什么是异步、为什么这么慢

`POST /paas/v4/videos/generations` 只回一个任务 id，要轮询 `GET /paas/v4/async-result/{id}`
直到 `task_status = SUCCESS`。免费模型实测 **56~63 秒**出一段 5 秒视频（高峰期排队更久）。
所以：

- 工具预算 `videoToolTimeoutMs`（默认 **9 分钟**）与轮询上限 `video.timeoutMs`（默认 8 分钟）
  分开声明 —— 到点抛一句人话，而不是把整轮冻住；
- mp4 落在 `~/.dsh/生成视频/`（手机桥白名单里有 `~/.dsh`，手机上才播得出来）。

---

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `providers` | `['pollinations','huggingface']` | 后端顺序，按序尝试。可填 `zhipu` / `together` / `huggingface` / `pollinations` |
| `zhipu.key` | `''` | **智谱 BigModel 的 key（国内推荐：直连可用、注册送额度、`cogview-3-flash` 免费）** |
| `zhipu.baseUrl` | `https://open.bigmodel.cn/api/paas/v4` | 智谱端点 |
| `zhipu.model` | `cogview-3-flash` | 免费模型；要更好画质可换 `cogview-3` / `cogview-3-plus`（计费） |

> **智谱只认官方那 7 档尺寸**：`1024x1024` `768x1344` `864x1152` `1344x768` `1152x864` `1440x720` `720x1440`。
> 你请求别的（比如手机生图面板的 1024×1536）会被**自动映射到比例最接近的一档**，不会因此失败
> （见 `pickZhipuSize`）。
| `endpoint` | `https://image.pollinations.ai/prompt/` | pollinations 接口前缀，prompt 以 URL 编码追加其后 |
| `model` | `flux` | pollinations 模型 |
| `width` / `height` | 1024 / 1024 | 默认尺寸（等于上游默认值；默认尺寸下**不写进 URL**，见下） |
| `enhance` | `false` | 接口侧提示词增强。**默认关**：匿名档带它会 402 |
| `private` | `false` | 隐藏到公共 feed。**默认关**：匿名档带它会 402 |
| `nologo` | `true` | pollinations 的 nologo 参数（⚠️ 实测**去不掉** pollinations 的水印，那是上游服务端烧进像素的） |
| `removeWatermark` | `true` | **出图后本地抹掉智谱右下角的「AI生成」角标**（见下） |
| `safe` | `false` | 严格 NSFW 过滤。**默认关**：匿名档带它会 402 |
| `token` | `''` | pollinations token（`auth.pollinations.ai` 免费注册） |
| `attach` | `true` | 默认是否取回并落为附件 |
| `huggingface.space` | `black-forest-labs/FLUX.1-schnell` | HF Space 后端 |
| `huggingface.steps` | 4 | FLUX.1-schnell 只支持 1–8 步 |
| `together.key` | `''` | **Together.ai 免费 key（最稳的路，见下）** |
| `together.baseUrl` | `https://api.together.xyz/v1` | OpenAI 兼容端点 |
| `together.model` | `black-forest-labs/FLUX.1-schnell-Free` | 官方标注免费无限量 |
| `timeoutMs` | 60000 | 单次取图超时 |

### 去水印（`removeWatermark`，默认开）

智谱的图右下角烧着一个「AI生成」角标。**官方的 `watermark_enabled: false` 实测无效** ——
用同一个 key 发过，回来的文件名照旧 `..._watermark.png`、像素上照旧有它，所以只能在本地做：

- 出图后自动**扩散修补**右下角 20%×10%（角标实测在 x 841–1014 / y 946–1014，外加一圈淡光晕）：
  用四周真实像素当边界重新解出来，多尺度金字塔，约 **0.8 秒/张**，没有硬接缝。
- **模式默认 `auto`**：先量水印框周围一圈的灰度标准差 —— 平滑背景（产品图/静物/风景）走
  `inpaint`（扩散修补）；**高对比线稿**（黑白漫画、浓墨排线）改走 `mirror`（把左侧那条带水平
  翻过来，保留黑白线条质感）。原因：线稿在那个尺度上信息量解不出来，扩散只会留下一块**灰斑**。
  强制指定：`--mode inpaint|mirror|crop`。
- 出图结果的 note 会写"已去掉…水印"，**不偷偷改图**；想保留角标（例如要公开发布 AI 内容、
  按规矩需要显式标识）就把 `removeWatermark` 设成 `false`。
- 处理已有的老图（用同一份实现）：

```bash
node scripts/dewatermark.mjs 图.jpg 输出.jpg        # 单张
node scripts/dewatermark.mjs ./某目录 --all          # 批量覆盖，原图留 .orig 备份
node scripts/dewatermark.mjs 图.jpg 输出.jpg --mode crop   # 直接裁掉最下面 10%
```

> 依赖 `sharp`：本机 dsh 安装里自带（它自己做图片归一化在用），`npm run build:local` 会把它
> 挂进本包 `node_modules`。找不到 sharp 时**只是不去水印**，图照出、note 里说明原因。

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

### 一条命令（推荐，本机情形）

```bash
npm run build:local          # 只看类型：npm run typecheck
```

`scripts/build-local.mjs` 自己搞定三件事，**不需要 git-bash，也不需要源码 checkout**：

1. **探测依赖源**：`DSH_CHECKOUT` → `D:/dsh/dsh-pinned`（固定安装：只有 `node_modules`）→
   `~/dsh-harness`、`~/dsh`、`~/.dsh/dsh-harness`（源码 checkout）。按"能不能拿到
   `dsh-tools`"判定可用，然后把 `@deepseek-ai/*` 用 junction 挂进本包 `node_modules`
   （Windows 上 junction 不需要管理员权限）。
2. **找一个够新的 tsc**：`$DSH_TSC` → 本包 `node_modules` → 缓存目录 `.tsc-cache/` →
   依赖源自带。都不行就下 npm tarball（只下一次，约 4MB）——**不走 `npm i`**：
   本机 npm 装包直接崩（`Cannot read properties of null (reading 'children')`）。
   版本 < 5 的一律弃用。
3. **编译**：`tsc -p tsconfig.json`，并写一个 `lib/.build-stamp` 方便对照热重载前后。

> 为什么不用全局 `tsc`：本机 PATH 上那个是 TypeScript **3.8.3**，不认 `target: ES2023` /
> `module: NodeNext` / `??=`，会刷出上百条 `@deepseek-ai/*.d.ts` 语法错误 —— 那是工具链
> 太老，不是代码有问题。

### 有 dsh 源码 checkout 时

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
```

（脚手架生成的 `build.sh` 只认源码 checkout 布局：`$CHECKOUT/packages/...`、`vendor/`、
`$CHECKOUT/node_modules/.bin/tsc`。上面那条 `npm run build:local` 两种布局都认。）

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
