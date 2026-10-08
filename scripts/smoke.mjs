/**
 * 冒烟测试：直接驱动构建产物 lib/index.js，在假 ctx 上跑通整条生图路径。
 *
 * 验证：工具注册 → 参数/值 schema 形态 → URL 编码 → 真实网络取图 →
 *       落附件（桩）→ render 产出 [text, image] 两个内容块。
 *
 * 用法：node scripts/smoke.mjs ["英文提示词"]
 */
import { apply, name, inject, Config } from '../lib/index.js'

const prompt = process.argv[2] ?? 'a red panda astronaut floating in a neon nebula, cinematic lighting, highly detailed'

let registered
const savedInputs = []
const fakeAttachments = {
  imageLimits: { mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
  async saveImages(inputs) {
    savedInputs.push(...inputs)
    return inputs.map((input) => ({
      attachmentId: 'sha256:0123456789abcdef',
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1920,
      height: 1080,
      ...(input.name === undefined ? {} : { name: input.name }),
    }))
  },
}

const ctx = {
  effect(fn) { return fn() },
  get(service) { return service === 'attachments' ? fakeAttachments : undefined },
  tools: { register(tool) { registered = tool; return () => {} } },
}

console.log(`plugin name = ${name}`)
console.log(`inject      = ${JSON.stringify(inject)}`)
console.log(`config ok   = ${typeof Config === 'function'}`)

apply(ctx, {
  endpoint: 'https://image.pollinations.ai/prompt/',
  width: 1920,
  height: 1080,
  model: 'flux',
  enhance: true,
  private: true,
  nologo: true,
  safe: true,
  attach: true,
  timeoutMs: 90000,
})

if (registered === undefined) throw new Error('smoke: 工具未注册')

console.log('\n=== 1. 工具契约 ===')
console.log(`name        = ${registered.name}`)
console.log(`parameters  = ${Object.keys(registered.parameters).join(', ')}`)
console.log(`output keys = ${Object.keys(registered.output.schema.properties).join(', ')}`)
console.log(`image spec  = ${JSON.stringify(registered.output.schema.properties.image.properties.mediaType.enum)}`)

console.log('\n=== 2. 执行（真实网络取图）===')
const startedAt = Date.now()
const value = await registered.execute({ prompt }, {})
console.log(`耗时        = ${Date.now() - startedAt} ms`)
console.log(`url         = ${value.url}`)
console.log(`size/model  = ${value.size} / ${value.model}`)
console.log(`markdown    = ${value.markdown}`)

console.log('\n=== 3. 附件落盘（桩记录）===')
for (const input of savedInputs) {
  console.log(`name=${input.name}  mediaType=${input.mediaType}  bytes=${input.data.byteLength}  head=${[...input.data.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`)
}
console.log(`image ref   = ${JSON.stringify(value.image)}`)

console.log('\n=== 4. render 产出内容块 ===')
const blocks = registered.output.render({ prompt }, value)
for (const block of blocks) {
  if (block.type === 'text') console.log(`[text]\n${block.text}`)
  else console.log(`[image] attachment=${JSON.stringify(block.attachment)}`)
}

console.log('\n=== 5. attach=false 分支 ===')
const textOnly = await registered.execute({ prompt, attach: false }, {})
console.log(`url     = ${textOnly.url}`)
console.log(`image   = ${textOnly.image === undefined ? 'undefined（未取图）' : 'present'}`)
console.log(`blocks  = ${JSON.stringify(registered.output.render({}, textOnly).map((b) => b.type))}`)

console.log('\nSMOKE OK')
