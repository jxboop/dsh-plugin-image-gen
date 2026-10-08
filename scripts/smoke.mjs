/**
 * 冒烟测试：直接驱动构建产物 lib/index.js，在假 ctx 上跑通整条生图路径。
 *
 * 验证：工具注册 → 参数/值 schema 形态 → URL 编码 → 真实网络取图 →
 *       落附件（桩）→ render 产出 [text, image] 两个内容块。
 *
 * 用法：node scripts/smoke.mjs ["英文提示词"]
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name, inject, Config } from '../lib/index.js'

// 本地配置文件默认写在 $DSH_HOME/image-gen.json —— 跑测试时把它指到临时目录，
// 免得污染使用者真实的 ~/.dsh。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-imagegen-smoke-'))
const localConfigPath = join(process.env.DSH_HOME, 'image-gen.json')

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

console.log('\n=== 6. 本地配置文件（~/.dsh/image-gen.json）===')
console.log(`模板已自动生成 = ${existsSync(localConfigPath)}  (${localConfigPath})`)
// 覆盖生效：只改 model，看 URL 里是不是真的变了（attach=false 不取图，最快）。
writeFileSync(localConfigPath, JSON.stringify({ model: 'sana', _说明: '测试', 不认识的键: 1 }), 'utf8')
const overridden = await registered.execute({ prompt, attach: false }, {})
console.log(`覆盖后 url      = ${overridden.url}`)
console.log(`覆盖生效        = ${String(overridden.url).includes('model=sana')}`)
console.log(`未知键有提示    = ${String(overridden.note ?? '').includes('不认识的键')}  note=${overridden.note ?? '(无)'}`)
// 写坏了也不能把功能带崩：报一句、按默认继续。
writeFileSync(localConfigPath, '{ 这不是 JSON', 'utf8')
const broken = await registered.execute({ prompt, attach: false }, {})
console.log(`坏文件仍能用    = ${typeof broken.url === 'string' && broken.url !== ''}`)
console.log(`坏文件有提示    = ${String(broken.note ?? '').includes('不是合法 JSON')}`)
writeFileSync(localConfigPath, JSON.stringify({ providers: ['pollinations', 'huggingface'] }), 'utf8')

console.log('\n=== 7. HF 连不通就快速跳过（国内网络必然遇到）===')
// ⚠️ 本地配置文件**优先于**组合配置 —— 第 6 段往里写了 providers，这里得同步改，
// 否则测的就不是 HF 那条路了（第一次就踩了这个）。
writeFileSync(localConfigPath, JSON.stringify({ providers: ['huggingface'] }), 'utf8')
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (String(url).includes('huggingface.co')) throw new Error('getaddrinfo ENOTFOUND huggingface.co')
  return await realFetch(url, init)
}
let hfOnly
apply({ ...ctx, tools: { register(tool) { hfOnly = tool; return () => {} } } }, {
  endpoint: 'https://image.pollinations.ai/prompt/',
  width: 512, height: 512, model: 'flux', enhance: false, private: false, nologo: true, safe: true,
  // 必须 attach=true：attach=false 那条分支压根不取图（只拼 URL），测不到 HF。
  attach: true, timeoutMs: 60000, providers: ['huggingface'],
})
const hfStart = Date.now()
let hfError = ''
try { await hfOnly.execute({ prompt }, {}) } catch (error) { hfError = String(error?.message ?? error) }
const hfMs = Date.now() - hfStart
console.log(`首次耗时        = ${hfMs} ms（探到不通就跳过，不该等满 60s）`)
console.log(`错误信息        = ${hfError.slice(0, 90)}`)
console.log(`判定            = 快=${hfMs < 12000} 说的是连不上=${hfError.includes('连不上')}`)
const hfSecond = Date.now()
let hfError2 = ''
try { await hfOnly.execute({ prompt }, {}) } catch (error) { hfError2 = String(error?.message ?? error) }
console.log(`第二次耗时      = ${Date.now() - hfSecond} ms  已记住=${hfError2.includes('已记住')}`)
globalThis.fetch = realFetch

console.log('\n=== 8. 智谱 CogView 后端（国内不用加速器那条）===')
writeFileSync(localConfigPath, JSON.stringify({ providers: ['zhipu'], zhipu: { key: 'test-zhipu-key' } }), 'utf8')
let sawZhipu = null
globalThis.fetch = async (url, init) => {
  const target = String(url)
  if (target.includes('open.bigmodel.cn')) {
    sawZhipu = { url: target, body: JSON.parse(String(init?.body ?? '{}')), auth: String(init?.headers?.authorization ?? '') }
    return new Response(JSON.stringify({ data: [{ url: 'https://example.invalid/fake.png' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  if (target.includes('example.invalid')) {
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
      status: 200, headers: { 'content-type': 'image/png' },
    })
  }
  return await realFetch(url, init)
}
let zhipuValue = null
let zhipuError = ''
try { zhipuValue = await registered.execute({ prompt }, {}) } catch (error) { zhipuError = String(error?.message ?? error) }
globalThis.fetch = realFetch
console.log(`请求 url      = ${sawZhipu?.url ?? '(没发出去)'}`)
console.log(`请求体        = ${JSON.stringify(sawZhipu?.body)}`)
console.log(`带 Bearer     = ${(sawZhipu?.auth ?? '').startsWith('Bearer ')}`)
console.log(`size 是字符串 = ${/^\d+x\d+$/.test(String(sawZhipu?.body?.size))}`)
console.log(`只塞三个字段  = ${sawZhipu !== null && JSON.stringify(Object.keys(sawZhipu.body).sort()) === '["model","prompt","size"]'}`)
console.log(`出图解析      = ${zhipuValue?.image === undefined ? '没拿到图 ' + zhipuError : '拿到图 ' + zhipuValue.image.mediaType + ' / ' + zhipuValue.model}`)

console.log('\nSMOKE OK')
