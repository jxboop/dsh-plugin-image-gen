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
import { loadSharp } from '../lib/dewatermark.js'

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
// ⚠️ key 必须是"合法形态"（含点）：智谱 key 是 <32位id>.<16位secret>，
// 形态不对会被发请求前的体检拦下（见第 9 段），这里就测不到请求体了。
const FAKE_ZHIPU_KEY = '0123456789abcdef0123456789abcdef.abcdefghijklmnop'
writeFileSync(localConfigPath, JSON.stringify({ providers: ['zhipu'], zhipu: { key: FAKE_ZHIPU_KEY } }), 'utf8')
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
// 尺寸映射：智谱只认官方那 7 档，手机生图面板给的 1024×1536 这种必须被换成最接近的档位。
// 期望值按"比例最接近"算：
//   1024×1536 = 2:3(0.667)  → 864x1152 = 3:4(0.750) 比 768x1344(0.571) 更近
//   1920×1080 = 16:9(1.778) → 1344x768 = 7:4(1.750) 比 1440x720(2.0) 更近
const zhipuSizes = ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440']
const sizeCases = [[1024, 1024, '1024x1024'], [1024, 1536, '864x1152'], [1536, 1024, '1152x864'], [1920, 1080, '1344x768']]
let sizeOk = true
for (const [w, h, want] of sizeCases) {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('open.bigmodel.cn')) {
      sawZhipu = { url: String(url), body: JSON.parse(String(init?.body ?? '{}')), auth: '' }
      return new Response(JSON.stringify({ data: [{ url: 'https://example.invalid/fake.png' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } })
  }
  writeFileSync(localConfigPath, JSON.stringify({ providers: ['zhipu'], zhipu: { key: FAKE_ZHIPU_KEY }, width: w, height: h }), 'utf8')
  await registered.execute({ prompt }, {})
  const got = sawZhipu?.body?.size
  const legal = zhipuSizes.includes(String(got))
  if (got !== want || !legal) { sizeOk = false; console.log(`  ⚠️ ${w}x${h} -> ${got}（期望 ${want}，合法=${legal}）`) }
}
globalThis.fetch = realFetch
console.log(`尺寸映射      = ${sizeOk ? '全对（1024x1536→864x1152、1920x1080→1344x768 …）' : '有错，见上'}`)

console.log('\n=== 9. 智谱 key 只复制了半截 → 发请求前就说清楚 ===')
// 真实翻车现场：控制台的 key 列表里 ID 和整串长得像，只复制点号前面的 32 位十六进制串，
// 服务端只回 "401 令牌已过期或验证不正确"，很容易被误判成"要重新注册/额度没了"。
let badKeyRequests = 0
globalThis.fetch = async (url, init) => {
  if (String(url).includes('open.bigmodel.cn')) badKeyRequests += 1
  return await realFetch(url, init)
}
writeFileSync(localConfigPath, JSON.stringify({ providers: ['zhipu'], zhipu: { key: '605da1b2c3d4e5f60718293a4b5c6d7e' } }), 'utf8')
let halfKeyError = ''
try { await registered.execute({ prompt }, {}) } catch (error) { halfKeyError = String(error?.message ?? error) }
globalThis.fetch = realFetch
console.log(`网络请求次数  = ${badKeyRequests}（应为 0，白跑一趟没有意义）`)
console.log(`错误信息      = ${halfKeyError.slice(0, 120)}…`)
console.log(`判定          = 点了名=${halfKeyError.includes('没有 "."')} 给了做法=${halfKeyError.includes('复制按钮')}`)
// 反例：合法的点号形态不能被误伤（否则以后智谱换 key 形态就全挂）。
let goodKeyRequests = 0
globalThis.fetch = async (url, init) => {
  if (String(url).includes('open.bigmodel.cn')) {
    goodKeyRequests += 1
    return new Response(JSON.stringify({ data: [{ url: 'https://example.invalid/fake.png' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } })
}
writeFileSync(localConfigPath, JSON.stringify({ providers: ['zhipu'], zhipu: { key: FAKE_ZHIPU_KEY } }), 'utf8')
let goodKeyValue = null
try { goodKeyValue = await registered.execute({ prompt }, {}) } catch (error) { goodKeyValue = String(error?.message ?? error) }
globalThis.fetch = realFetch
console.log(`合法 key 照发 = ${goodKeyRequests === 1}  出图=${goodKeyValue?.image === undefined ? String(goodKeyValue).slice(0, 60) : goodKeyValue.model}`)

console.log('\n=== 10. 出图后本地抹掉智谱的「AI生成」角标 ===')
/*
 * 现场：智谱的图右下角烧着「AI生成」。官方请求体里的 `watermark_enabled: false` **实测无效**
 * （2026-10-08 发过，文件名照旧 ..._watermark.png、像素照旧有角标），所以只能本地做：
 * 把右下角 20%×10% 用**扩散修补**重解（src/dewatermark.ts）。
 *
 * 这里合成一张"带角标"的图当上游产物，验证三件事：
 *   ① 角标那块真的变了；② 框【外面】几乎没被动过（去水印不能毁图）；③ 关掉开关就一点也不动。
 */
{
  const sharp = loadSharp()
  const box = { left: Math.round(1024 * 0.8), top: Math.round(1024 * 0.9), width: 205, height: 102 }
  const base = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 206, g: 210, b: 214 } } })
    .jpeg().toBuffer()
  const mark = await sharp({ create: { width: box.width - 20, height: box.height - 24, channels: 4, background: { r: 60, g: 60, b: 60, alpha: 1 } } })
    .png().toBuffer()
  const watermarked = await sharp(base)
    .composite([{ input: mark, left: box.left + 10, top: box.top + 12 }])
    .jpeg({ quality: 95 })
    .toBuffer()

  /** 区域内逐像素平均差（0-255）。 */
  const regionDiff = async (a, b, region) => {
    const one = await sharp(a).extract(region).removeAlpha().raw().toBuffer()
    const two = await sharp(b).extract(region).removeAlpha().raw().toBuffer()
    let sum = 0
    for (let i = 0; i < one.length; i += 1) sum += Math.abs(one[i] - two[i])
    return sum / one.length
  }

  const serveWatermarked = () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('open.bigmodel.cn')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://example.invalid/fake.png' }] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      if (String(url).includes('example.invalid')) {
        return new Response(watermarked, { status: 200, headers: { 'content-type': 'image/png' } })
      }
      return await realFetch(url, init)
    }
  }

  const runOnce = async (removeWatermark) => {
    savedInputs.length = 0
    writeFileSync(localConfigPath, JSON.stringify({
      providers: ['zhipu'], width: 1024, height: 1024, removeWatermark, zhipu: { key: FAKE_ZHIPU_KEY },
    }), 'utf8')
    serveWatermarked()
    const value = await registered.execute({ prompt }, {})
    globalThis.fetch = realFetch
    return { value, saved: savedInputs[0]?.data }
  }

  const on = await runOnce(true)
  const off = await runOnce(false)
  const cleaned = Buffer.from(on.saved ?? [])
  const untouched = Buffer.from(off.saved ?? [])
  console.log(`出图成功      = ${on.value?.image === undefined ? '没出图' : on.value.image.mediaType + ' / ' + on.value.model}`)
  console.log(`note 有交代   = ${String(on.value?.note ?? '').includes('去水印') || String(on.value?.note ?? '').includes('AI生成')}`)
  const inside = cleaned.length === 0 ? 0 : await regionDiff(watermarked, cleaned, box)
  const outside = cleaned.length === 0 ? 0 : await regionDiff(watermarked, cleaned, { left: 0, top: box.top - 130, width: 1024, height: 120 })
  console.log(`角标区域变化  = ${inside.toFixed(1)}（应远大于 0：那块被重解掉了）`)
  console.log(`框外变化      = ${outside.toFixed(3)}（应≈0：不能把图其它地方也改了）`)
  console.log(`产物是 JPEG   = ${cleaned[0] === 0xff && cleaned[1] === 0xd8}`)
  let mismatch = 0
  for (let i = 0; i < Math.min(untouched.length, watermarked.length); i += 1) {
    if (untouched[i] !== watermarked[i]) mismatch += 1
  }
  console.log(`关掉开关就不动= ${untouched.length === watermarked.length && mismatch === 0}` +
    `（存进去 ${untouched.length} 字节 / 上游 ${watermarked.length} 字节，不同字节 ${mismatch}）`)
  console.log(`关掉后没交代  = ${String(off.value?.note ?? '').includes('去水印') === false}`)
  writeFileSync(localConfigPath, JSON.stringify({ providers: ['zhipu'], zhipu: { key: FAKE_ZHIPU_KEY } }), 'utf8')
}

console.log('\n=== 11. 水印模式的自动选择（平滑背景→扩散修补；黑白线稿→镜像）===')
/*
 * 现场（2026-10-08）：一张黑白漫画风的图，扩散修补在右下角留下一块**灰斑** —— 线稿在那个
 * 尺度上没法被"解"出来。改用镜像（把左侧那条带翻过来）会保留黑白线条的质感，自然得多。
 * 顺带修一个真 bug：移植到 TS 时把 `mirror` 分支整个丢了（CLI 还写着有这个模式，跑出来却
 * 和 inpaint 逐字节一样）。
 */
{
  const sharp = loadSharp()
  const { dewatermark } = await import('../lib/dewatermark.js')
  const box = { left: 819, top: 922, width: 205, height: 102 }
  // 高对比：右上角画粗黑白条纹 + 右下角一块黑（模拟线稿角落）
  const stripes = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">` +
    `<rect width="1024" height="1024" fill="#fff"/>` +
    `<g fill="#000">${Array.from({ length: 60 }, (_, i) => `<rect x="${i * 17}" y="0" width="8" height="900"/>`).join('')}</g>` +
    `<rect x="600" y="760" width="424" height="264" fill="#000"/>` +
    `<rect x="700" y="880" width="200" height="100" fill="#888"/></svg>`)
  const lineArt = await sharp(stripes).jpeg({ quality: 95 }).toBuffer()
  // 平滑背景：淡淡渐变 + 一块水印
  const smoothBase = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 208, g: 212, b: 216 } } }).jpeg({ quality: 95 }).toBuffer()
  const mark = await sharp({ create: { width: 185, height: 78, channels: 4, background: { r: 90, g: 90, b: 90, alpha: 1 } } }).png().toBuffer()
  const smooth = await sharp(smoothBase).composite([{ input: mark, left: box.left + 10, top: box.top + 12 }]).jpeg({ quality: 95 }).toBuffer()

  const bytesOf = async (input, mode) => Buffer.from(await dewatermark(input, { mode }))
  const same = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0

  const lineAuto = await bytesOf(lineArt, 'auto')
  const lineMirror = await bytesOf(lineArt, 'mirror')
  const lineInpaint = await bytesOf(lineArt, 'inpaint')
  console.log(`线稿：auto=mirror ? ${same(lineAuto, lineMirror)}（auto≠inpaint：${same(lineAuto, lineInpaint) === false}）`)
  console.log(`mirror 真的不一样了 ? ${same(lineMirror, lineInpaint) === false}（这就是之前丢掉的模式）`)

  const smoothAuto = await bytesOf(smooth, 'auto')
  const smoothInpaint = await bytesOf(smooth, 'inpaint')
  console.log(`平滑背景：auto=inpaint ? ${same(smoothAuto, smoothInpaint)}`)

  // 两种模式都不能把角落以外的地方改坏（只准动那个框）。
  const outside = { left: 0, top: box.top - 140, width: 1024, height: 130 }
  const diffOutside = async (a, b) => {
    const one = await sharp(a).extract(outside).removeAlpha().raw().toBuffer()
    const two = await sharp(b).extract(outside).removeAlpha().raw().toBuffer()
    let sum = 0
    for (let i = 0; i < one.length; i += 1) sum += Math.abs(one[i] - two[i])
    return sum / one.length
  }
  console.log(`线稿框外变化 = ${(await diffOutside(lineArt, lineAuto)).toFixed(3)}（应≈0）`)
  console.log(`平滑框外变化 = ${(await diffOutside(smooth, smoothAuto)).toFixed(3)}（应≈0）`)
}

console.log('\nSMOKE OK')
