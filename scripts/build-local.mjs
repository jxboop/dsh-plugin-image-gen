/**
 * 本机构建（不依赖 git-bash、不依赖源码 checkout）：src/ → lib/。
 *
 * 为什么不用 scripts/build.sh：那是 dsh-super-injector 脚手架生成的版本，它假定
 * DSH_CHECKOUT 是一份**源码 checkout**（有 packages/ 且 node_modules/.bin/tsc 在）。
 * 本机的真实情况是**固定安装**（D:\dsh\dsh-pinned：只有 node_modules，没有 packages/、
 * 也没有 tsc），于是 build.sh 报 "tsc not found"、npm run build:local 又会让 npx 抓到
 * 全局那个 3.8.3 的老 tsc（连 `??=`、`satisfies` 都不认，报一堆 TS1005）。
 *
 * 这个脚本做三件事：
 *   1. 探测依赖源（固定安装优先，其次源码 checkout），把 @deepseek-ai/* 用 junction 挂进
 *      本包 node_modules（Windows 上 junction 不需要管理员权限）。
 *   2. 找一个**够新的** tsc：$DSH_TSC → 本包 node_modules → 依赖源自带 →
 *      缓存目录（.tsc-cache/）→ 全局（仅当版本 ≥5）。都没有就下载 npm tarball 到缓存目录。
 *   3. 跑 tsc -p tsconfig.json。
 *
 * 用法：node scripts/build-local.mjs [--check]（--check = 只类型检查，不产出）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NM = join(ROOT, 'node_modules')
const CACHE = join(ROOT, '.tsc-cache')
const TS_WANT = '5.9.3'

/** 需要挂进本包的依赖（键 = 安装到 node_modules 下的路径，值 = 各布局下的相对候选）。 */
const DEPS = {
  '@deepseek-ai/cordis': ['node_modules/@deepseek-ai/cordis', 'vendor/cordis'],
  '@deepseek-ai/cosmokit': ['node_modules/@deepseek-ai/cosmokit', 'vendor/cosmokit'],
  '@deepseek-ai/schemastery': ['node_modules/@deepseek-ai/schemastery', 'vendor/schemastery'],
  '@deepseek-ai/dsh-tools': ['node_modules/@deepseek-ai/dsh-tools', 'packages/core/tools'],
  '@deepseek-ai/dsh-llm': ['node_modules/@deepseek-ai/dsh-llm', 'packages/llm/llm'],
  '@deepseek-ai/dsh-system-prompt': ['node_modules/@deepseek-ai/dsh-system-prompt', 'packages/core/system-prompt'],
  '@deepseek-ai/dsh-attachment': ['node_modules/@deepseek-ai/dsh-attachment', 'packages/core/attachment'],
  '@types/node': ['node_modules/@types/node', 'node_modules/@types/node'],
  // 去水印（src/dewatermark.ts）要动像素：sharp 是 dsh 安装自带的那份（它自己做图片
  // 归一化也在用），挂个 junction 让插件运行时能 require 到，不必额外下载。
  sharp: ['node_modules/sharp', 'node_modules/sharp'],
}

/** 依赖源候选：固定安装 → 源码 checkout。 */
function findSource() {
  const env = process.env.DSH_CHECKOUT ?? process.env.DSH_DEPS ?? ''
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const candidates = [
    env,
    'D:/dsh/dsh-pinned',
    join(home, 'dsh-harness'),
    join(home, 'dsh'),
    join(home, '.dsh', 'dsh-harness'),
  ].filter((entry) => entry !== '')
  for (const candidate of candidates) {
    const dir = resolve(candidate)
    // 判据：能挂到最主要的那个包就算可用（固定安装看 node_modules，源码看 packages）。
    const marks = ['node_modules/@deepseek-ai/dsh-tools', 'packages/core/tools']
    if (marks.some((mark) => existsSync(join(dir, mark)))) return dir
  }
  return undefined
}

function linkDeps(source) {
  let linked = 0
  for (const [name, relatives] of Object.entries(DEPS)) {
    const target = relatives.map((rel) => join(source, rel)).find((candidate) => existsSync(candidate))
    if (target === undefined) {
      console.log(`  ⚠️ 依赖缺失（跳过）：${name}`)
      continue
    }
    const link = join(NM, ...name.split('/'))
    rmSync(link, { recursive: true, force: true })
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target, link, 'junction')
    linked += 1
  }
  // schemastery 依赖的 @standard-schema/spec：pnpm 布局藏在 .pnpm 里，找得到就挂。
  const spec = findStandardSchema(source)
  if (spec !== undefined) {
    const link = join(NM, '@standard-schema', 'spec')
    rmSync(join(NM, '@standard-schema'), { recursive: true, force: true })
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(spec, link, 'junction')
  }
  return linked
}

function findStandardSchema(source) {
  const direct = join(source, 'node_modules/@standard-schema/spec')
  if (existsSync(direct)) return direct
  const pnpm = join(source, 'node_modules/.pnpm')
  if (!existsSync(pnpm)) return undefined
  for (const entry of readdirSync(pnpm)) {
    if (!entry.startsWith('@standard-schema+spec@')) continue
    const candidate = join(pnpm, entry, 'node_modules/@standard-schema/spec')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** tsc 候选：返回可直接用 node 执行的入口（tsc.js）。 */
function findTscEntry(source) {
  const candidates = [
    process.env.DSH_TSC,
    join(NM, 'typescript/lib/tsc.js'),
    join(CACHE, `ts-${TS_WANT}/package/lib/tsc.js`),
    join(source, 'node_modules/typescript/lib/tsc.js'),
  ].filter((entry) => typeof entry === 'string' && entry !== '')
  for (const entry of candidates) {
    if (existsSync(entry)) return entry
  }
  return undefined
}

function tscVersion(entry) {
  try {
    return execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/**
 * 缓存里没有 tsc 就下 npm tarball（只下一次，约 4MB）。
 * 为什么不用 npm i：本机 npm 装包直接崩（`Cannot read properties of null (reading 'children')`），
 * 而 tarball 是纯 HTTP 下载 + 解压，稳。
 */
function downloadTsc() {
  const dir = join(CACHE, `ts-${TS_WANT}`)
  const entry = join(dir, 'package/lib/tsc.js')
  if (existsSync(entry)) return entry
  const tgz = join(CACHE, `typescript-${TS_WANT}.tgz`)
  mkdirSync(CACHE, { recursive: true })
  const url = `https://registry.npmjs.org/typescript/-/typescript-${TS_WANT}.tgz`
  console.log(`=== 下载 tsc（${url}）===`)
  const script = [
    'const { writeFileSync } = require("node:fs");',
    '(async () => {',
    `  const res = await fetch(${JSON.stringify(url)});`,
    '  if (!res.ok) throw new Error("HTTP " + res.status);',
    '  writeFileSync(process.argv[1], Buffer.from(await res.arrayBuffer()));',
    '})();',
  ].join('\n')
  execFileSync(process.execPath, ['-e', script, tgz], { stdio: 'inherit' })
  mkdirSync(dir, { recursive: true })
  execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'inherit' })
  return entry
}

const checkOnly = process.argv.includes('--check')

console.log('=== 1. 探测依赖源 ===')
const source = findSource()
if (source === undefined) {
  console.error('build-local: 找不到 DSH 安装/checkout（可用 DSH_CHECKOUT 指定）')
  process.exit(1)
}
console.log(`  source = ${source}`)

console.log('=== 2. 挂依赖（junction）===')
const linked = linkDeps(source)
console.log(`  已挂 ${linked}/${Object.keys(DEPS).length}`)

console.log('=== 3. 找 tsc ===')
let entry = findTscEntry(source)
if (entry === undefined) entry = downloadTsc()
let version = tscVersion(entry)
const major = Number.parseInt(version.replace(/^Version\s+/, '').split('.')[0] ?? '0', 10)
// 老 tsc 会把 ES2023 + `??=` 全判成语法错误，与其让它吐一屏 TS1005，不如直接换掉。
if (Number.isNaN(major) || major < 5) {
  console.log(`  现有 tsc（${version || entry}）不够新，改用缓存里的 ${TS_WANT}`)
  entry = downloadTsc()
  version = tscVersion(entry)
}
console.log(`  tsc = ${entry}  (${version})`)

console.log(`=== 4. ${checkOnly ? '类型检查' : '编译 src → lib'} ===`)
const args = ['-p', 'tsconfig.json', ...(checkOnly ? ['--noEmit'] : [])]
execFileSync(process.execPath, [entry, ...args], { stdio: 'inherit', cwd: ROOT })

// 构建完把产物时间戳写下来，方便 dev_reload_package 前后对照。
if (!checkOnly) {
  writeFileSync(join(ROOT, 'lib', '.build-stamp'), `${new Date().toISOString()} ${version}\n`, 'utf8')
}
console.log('=== 构建完成 ===')
