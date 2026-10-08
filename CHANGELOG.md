# 更新日志

本文件只记**用户能感知到的变化**。

---

## 1.0.1 — 2026-10-08

### 修

**装上之后 DSH 不会挂载它（缺 bundle 声明）**

- 本包之前只有 `lib/` + `package.json`，**没有 `cordis.patch.yml`，也没有 `dsh.bundle` 声明** ——
  照"一条命令装插件"装下来，pnpm 会把依赖装上，但 **DSH 的组合里没有它的装配行**，
  `apply()` 永远不会跑 → 结果是"装完了，agent 还是说没有 `image_generate` 这个工具"。
- 修：补上 `cordis.patch.yml`（`- insert: - id: image-gen`）并在 `package.json` 里声明
  `dsh.bundle.patch`，同时把它加进 `files`。
- README 也补了一句兜底：万一还是没挂上，就把包名加进 profile 的 `dsh.profile.bundles`。

### 文档

- README 新增《配置（可选，但建议）》：免费后端会限流/配额用尽（402），想稳定出图就用
  Together.ai 的免费 key，并给出完整的 `cordis.patch.yml` 配置片段。

## 1.0.0 — 2026-10-08

第一个公开版本。把「一条提示词 → 一张图」做成 DSH 的 host 工具 **`image_generate`**：

- **工具**：`prompt`（英文、尽量具体）+ 可选 `width` / `height` / `model` / `seed` / `attach`。
  工具**只做 URL 编码，不改写提示词** —— 完善描述由会话里的模型负责。
- **落盘为附件**：取回的字节存进 `attachments`（`sha256` 附件引用），以**真正的图片块**显示 ——
  GUI 一定能渲染，手机上还能点开、长按存相册（markdown 外链做不到这一点）。
- **多后端取图**：HF Space（FLUX，无水印）优先，pollinations 兜底；失败时按档位降级重试。
- **超时**：工具声明了 `timeoutMs`（默认 3 分钟，配置项 `toolTimeoutMs`）——
  DSH 的工具超时是**协作式**的，工具自己不返回就会把整轮乃至整个会话冻住；声明之后由
  `dsh-tool-call-timeout-policy` 接管，超时返回一条工具结果，回合继续走完。
- **手机桥联动**：手机界面工具栏的「生图」键就是调它（那个键只是入口，不直连生图后端）。

仓库自带构建产物 `lib/`，装上即可用，不需要在本地编译。
