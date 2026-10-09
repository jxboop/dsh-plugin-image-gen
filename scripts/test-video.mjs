/**
 * video_generate 的测试：默认打**本地桩**（不花钱、秒级），`--live` 才打真智谱接口。
 *
 *   node scripts/test-video.mjs          # 桩：验协议 + 落盘 + 参数
 *   node scripts/test-video.mjs --live   # 真接口：验"确实能出片"（免费模型，约 1 分钟）
 *
 * 为什么要驱动**真实注册的插件**而不是照抄一遍 HTTP 调用：抄一遍只能证明"我抄对了"，
 * 用假 ctx 把 apply() 跑起来、再调它注册出来的工具，验的是发布出去的那份代码。
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const live = process.argv.includes('--live')
// 插件的 key 体检要求 `<32位id>.<16位secret>` 形态，桩也得给一个合法的假 key。
const STUB_KEY = 'abcdefghijklmnopqrstuvwxyz012345.0123456789abcdef'
const home = await mkdtemp(join(tmpdir(), 'image-gen-video-'))
process.env.DSH_HOME = home

let pass = 0
let fail = 0
function check(label, ok, extra = '') {
	if (ok) { pass += 1; console.log(`  PASS  ${label}${extra === '' ? '' : '  — ' + extra}`) }
	else { fail += 1; console.log(`  FAIL  ${label}${extra === '' ? '' : '  — ' + extra}`) }
}

/* ---------------- 桩后端：提交 → 轮询（先 PROCESSING，再 SUCCESS）→ 给一个假 mp4 ---------------- */
const FAKE_MP4 = Buffer.concat([
	Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(32, 7),
])
const calls = { submits: [], polls: 0, downloads: 0 }
let pollsBeforeSuccess = 1
const stub = createServer((req, res) => {
	const url = String(req.url ?? '')
	if (req.method === 'POST' && url.endsWith('/videos/generations')) {
		const chunks = []
		req.on('data', (c) => chunks.push(c))
		req.on('end', () => {
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
			calls.submits.push({ body, auth: req.headers.authorization ?? '' })
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ id: 'stub-task-1', model: body.model, task_status: 'PROCESSING' }))
		})
		return
	}
	if (url.includes('/async-result/')) {
		calls.polls += 1
		res.writeHead(200, { 'content-type': 'application/json' })
		if (calls.polls <= pollsBeforeSuccess) {
			res.end(JSON.stringify({ task_status: 'PROCESSING' }))
			return
		}
		res.end(JSON.stringify({
			task_status: 'SUCCESS',
			video_result: [{ url: `http://127.0.0.1:${stub.address().port}/fake.mp4`, cover_image_url: `http://127.0.0.1:${stub.address().port}/fake.png` }],
		}))
		return
	}
	if (url.endsWith('/fake.mp4')) {
		calls.downloads += 1
		res.writeHead(200, { 'content-type': 'video/mp4' })
		res.end(FAKE_MP4)
		return
	}
	res.writeHead(404).end('nope')
})
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
const stubPort = stub.address().port

/* ---------------- 载入插件（假 ctx，够 apply() 跑起来） ---------------- */
const registered = new Map()
const fakeCtx = {
	effect(callback) { callback() },
	tools: { register(definition) { registered.set(definition.name, definition); return () => {} } },
	get(name) {
		if (name !== 'attachments') return undefined
		return { imageLimits: { mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }, saveImages: async () => [] }
	},
}
const plugin = await import('../lib/index.js')
const config = {
	...plugin.Config({ zhipu: { key: STUB_KEY }, video: { baseUrl: `http://127.0.0.1:${stubPort}`, pollIntervalMs: 50, dir: '生成视频' } }),
	video: { ...plugin.Config({}).video, baseUrl: `http://127.0.0.1:${stubPort}`, pollIntervalMs: 50, dir: '生成视频', key: STUB_KEY },
}
plugin.apply(fakeCtx, config)

check('插件注册出了 video_generate 工具', registered.has('video_generate'), [...registered.keys()].join(','))
const tool = registered.get('video_generate')

if (live === false) {
	const out = await tool.execute({ prompt: '一只红苹果在桌上缓慢旋转', size: '1280x720', fps: 30 })
	const submit = calls.submits[0]
	check('提交体带上了模型与提示词',
		submit?.body?.model === 'cogvideox-flash' && submit?.body?.prompt.includes('红苹果') && submit?.body?.size === '1280x720',
		JSON.stringify(submit?.body))
	check('提交带了 Bearer key', String(submit?.auth ?? '').startsWith('Bearer '), String(submit?.auth))
	check('PROCESSING 时会继续轮询', calls.polls >= 2, `${calls.polls} 次查询`)
	check('把视频取回落到了盘上', calls.downloads === 1 && typeof out.path === 'string', String(out.path))
	const info = await stat(out.path)
	check('落盘内容与上游一致', info.size === FAKE_MP4.byteLength, `${info.size} 字节`)
	check('文件名是 .mp4（手机桥靠这个后缀认成视频）', out.path.endsWith('.mp4'), out.path)
	check('返回里带了封面与真接口地址', String(out.coverUrl ?? '').includes('fake.png') && String(out.url).includes('fake.mp4'))
	check('默认落盘在 ~/.dsh 下（手机桥的白名单认识它）', out.path.startsWith(home), out.path)
	const rendered = tool.output.render({}, out)
	const text = String(rendered?.[0]?.text ?? '')
	check('渲染里出现完整路径（手机端把它变成可播视频）', text.includes(out.path), text.split('\n')[0])
	check('免费模型会提示水印/计费说明', /水印|cogvideox-3/.test(String(out.note ?? '')), String(out.note ?? '').slice(0, 60))
} else {
	console.log('  （--live：真打智谱接口，约 1 分钟）')
	const key = JSON.parse(await readFile(join(process.env.USERPROFILE ?? '', '.dsh', 'image-gen.json'), 'utf8')).zhipu.key
	config.zhipu.key = key
	config.video = { ...config.video, baseUrl: 'https://open.bigmodel.cn/api/paas/v4', key, pollIntervalMs: 5000, timeoutMs: 480000 }
	const out = await tool.execute({ prompt: 'a red apple on a white table, slow camera push in, soft daylight', size: '1920x1080', fps: 30 })
	const info = await stat(out.path)
	check('真接口出了片并落盘', info.size > 100 * 1024, `${Math.round(info.size / 1024)} KB，等待 ${out.seconds} 秒`)
	const ffmpeg = join(process.env.USERPROFILE ?? '', '.dsh', 'bin', 'ffmpeg.exe')
	const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', out.path], { encoding: 'utf8' })
	const meta = String(probe.stderr ?? '')
	check('落盘的是可解码的 mp4（ffmpeg 认得出视频流）', /Video:/.test(meta),
		(meta.match(/Duration: [^,]+/) ?? ['(没有时长)'])[0] + ' ' + (meta.match(/Video: [^,]+/) ?? [''])[0].slice(0, 60))
	console.log('  文件：', out.path)
}

stub.close()
console.log(`\n  ${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
