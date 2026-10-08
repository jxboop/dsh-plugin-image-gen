/**
 * 命令行：去掉智谱 CogView 右下角的「AI生成」水印。
 *
 * 算法本体在 `src/dewatermark.ts`（编译到 `lib/dewatermark.js`），这里只是薄壳 ——
 * 这样"插件里自动去水印"和"手动处理老图"用的是同一份实现，不会两边跑偏。
 *
 * 用法（先 `npm run build:local` 保证 lib 是新的）：
 *   node scripts/dewatermark.mjs <图> [输出] [--mode inpaint|crop] [--box l,t,w,h] [--quality 95]
 *   node scripts/dewatermark.mjs <目录> --all        # 批量覆盖，原图留 .orig 备份
 *
 * 实测坑：官方 `watermark_enabled: false` **无效**（照旧带角标），所以只能在本地做像素级处理。
 */
import { readFile, writeFile, readdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, basename, dirname } from 'node:path'
import { dewatermark, watermarkBox } from '../lib/dewatermark.js'

const argv = process.argv.slice(2)
if (argv.length === 0 || argv.includes('--help')) {
  console.log('用法: node scripts/dewatermark.mjs <图或目录> [输出] [--mode inpaint|crop] [--all] [--box l,t,w,h] [--quality 95]')
  process.exit(argv.length === 0 ? 2 : 0)
}
const all = argv.includes('--all')
const modeArg = argv[argv.indexOf('--mode') + 1]
const boxArg = argv[argv.indexOf('--box') + 1]
const qualityArg = argv[argv.indexOf('--quality') + 1]
const options = {
  mode: argv.includes('--mode') ? modeArg : 'inpaint',
  quality: argv.includes('--quality') ? Number(qualityArg) : 95,
  box: argv.includes('--box')
    ? (() => {
        const [left, top, width, height] = boxArg.split(',').map(Number)
        return { left, top, width, height }
      })()
    : undefined,
}
const inputs = argv.filter((arg, index) => arg.startsWith('--') === false
  && ['--box', '--quality', '--mode'].includes(argv[index - 1]) === false)

async function convertOne(input, output) {
  const bytes = await dewatermark(await readFile(input), options)
  await writeFile(output, bytes)
  const meta = await import('../lib/dewatermark.js').then((mod) => mod.watermarkBox(1024, 1024))
  return { size: bytes.length, meta }
}

if (all) {
  const dir = inputs[0]
  const names = (await readdir(dir)).filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
  for (const name of names) {
    const file = join(dir, name)
    const backup = join(dir, basename(name, extname(name)) + '.orig' + extname(name))
    if (existsSync(backup) === false) await copyFile(file, backup)
    const { size } = await convertOne(file, file)
    console.log(`  ${name} → ${Math.round(size / 1024)} KB（原图备份 .orig）`)
  }
  console.log(`共处理 ${names.length} 张`)
} else {
  const input = inputs[0]
  const output = inputs[1] ?? join(dirname(input), basename(input, extname(input)) + '-clean.jpg')
  const { size } = await convertOne(input, output)
  const box = options.box ?? watermarkBox(1024, 1024)
  console.log(`${input} → ${output}（${Math.round(size / 1024)} KB，mode=${options.mode}，框 ${JSON.stringify(box)}）`)
}
