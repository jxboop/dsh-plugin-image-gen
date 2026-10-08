/**
 * 链接编译期依赖（无需 dsh 源码 checkout 的构建路径）。
 *
 * 脚手架生成的 scripts/build.sh 假设存在源码 checkout（$CHECKOUT/packages/... 与 vendor/）。
 * 本机只有 npm 安装包（npx 缓存布局：node_modules/@deepseek-ai/<pkg>/lib/index.js + lib/types/*.d.ts），
 * 所以这里把编译/运行需要的包直接 junction 到插件自己的 node_modules。
 *
 * 用法：node scripts/link-deps.mjs [--root <dsh 安装根>]
 *   默认探测顺序：$DSH_INSTALL → npx 缓存里的 @deepseek-ai/dsh 安装 → 报错退出
 */
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 编译/运行需要的包（build.sh 的清单 + 本插件实际 import 的）。 */
const PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-system-prompt',
]

/** 找一个 dsh 安装根：其 node_modules/@deepseek-ai/dsh 存在。 */
function locateInstall() {
  const explicit = process.env.DSH_INSTALL
  if (explicit) return explicit

  const npx = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'npm-cache', '_npx')
  if (existsSync(npx)) {
    for (const entry of readdirSync(npx)) {
      const candidate = join(npx, entry)
      if (existsSync(join(candidate, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) return candidate
    }
  }
  return undefined
}

function link(from, to) {
  rmSync(from, { recursive: true, force: true })
  mkdirSync(dirname(from), { recursive: true })
  symlinkSync(resolve(to), from, process.platform === 'win32' ? 'junction' : 'dir')
}

const root = locateInstall()
if (root === undefined) {
  console.error('link-deps: 找不到 dsh 安装根；设置 DSH_INSTALL 环境变量后重试')
  process.exit(1)
}
const modules = join(root, 'node_modules')
console.log(`link-deps: dsh 安装根 = ${root}`)

let linked = 0
for (const pkg of PACKAGES) {
  const target = join(modules, ...pkg.split('/'))
  const dest = join(ROOT, 'node_modules', ...pkg.split('/'))
  if (!existsSync(join(target, 'package.json'))) {
    console.warn(`link-deps: 跳过（未安装）${pkg}`)
    continue
  }
  link(dest, target)
  linked += 1
  console.log(`  link ${pkg}`)
}

// @types/node：编译期类型。优先用安装根或已安装的 dsh-market 里那份。
const typeCandidates = [
  join(modules, '@types', 'node'),
  join(process.env.USERPROFILE ?? homedir(), '.dsh', 'plugin-src', 'dsh-market', 'node_modules', '@types', 'node'),
]
for (const candidate of typeCandidates) {
  if (existsSync(join(candidate, 'package.json'))) {
    link(join(ROOT, 'node_modules', '@types', 'node'), candidate)
    console.log(`  link @types/node  (${realpathSync(candidate)})`)
    linked += 1
    break
  }
}

console.log(`link-deps: 完成，共链接 ${linked} 个包`)
