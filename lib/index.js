/**
 * @dsh-external/dsh-plugin-image-gen — 工具包形态。
 *
 * 把"生图路径"做成一个可复用工具：
 *   prompt（英文、尽量具体）→ URL 编码 → pollinations 生图接口 → 取回字节
 *   → 存入 attachments（拿到 sha256 附件引用）→ 以真正的图片块显示。
 *
 * 为什么要落附件而不是只回一段 markdown：
 *   markdown 图片能否渲染取决于 GUI 渲染器与 CSP；附件是 DSH 原生图片通路
 *   （read_image 走的就是它），`{ type: 'image', attachment }` 一定能显示。
 *   两条路都给：文本块带 markdown 与直链，图片块带真图。
 *
 * 关于 token 成本与文本模型：
 *   图片块会随请求送入模型（我就能"看到"这张图）。对不支持图片输入的模型，
 *   请求装配会走 dsh-llm 的 projectImagesForTextModel 把它投影成文本句柄，
 *   不会报错、GUI 仍从会话日志渲染附件。不需要我看图时传 attach=false 即可。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AttachmentId } from '@deepseek-ai/dsh-attachment';
import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
export const name = '@dsh-external/dsh-plugin-image-gen';
export const inject = ['tools', 'attachments'];
export const Config = z.object({
    /** 生图接口前缀，prompt 以 URL 编码追加在其后。 */
    endpoint: z.string().default('https://image.pollinations.ai/prompt/'),
    /**
     * 默认尺寸。取 1024×1024 = pollinations 上游自身的默认值——显式写 width/height
     * 在匿名档会被判到付费面（402），所以默认尺寸下干脆不写进 URL，报出的尺寸即上游默认。
     */
    width: z.number().default(1024),
    height: z.number().default(1024),
    /**
     * 默认模型。实测（2026-10）匿名档唯一稳定可用的是极简 URL + `model=flux`：
     * sana/turbo 会 402（"Insufficient balance"），flux 极简可出图。
     */
    model: z.string().default('flux'),
    /**
     * 提示词增强。**默认 false**：enhance=true 属付费面，匿名请求会 402，故默认关闭。
     */
    enhance: z.boolean().default(false),
    /**
     * private=true 在匿名档会整体落到付费判定（实测 402），**默认 false**；
     * 有 token 的部署可打开。注意：关闭后生成的图会出现在 pollinations 公共 feed 里。
     */
    private: z.boolean().default(false),
    /**
     * 传给 pollinations 的 `nologo` 参数。⚠️ 实测（2026-10）它**去不掉水印**：
     * 免费匿名档的 pollinations.ai 水印由上游服务端烧进像素，带不带 nologo 都在。
     * 想要无水印图只能换后端（默认已改为 huggingface / 或配 together.key）。
     */
    nologo: z.boolean().default(true),
    /**
     * 安全过滤。**默认 false**：实测 safe=true 会被判到付费面返回 402，
     * 故默认关闭以免工具整体不可用；需要严格过滤时再手动打开。
     */
    safe: z.boolean().default(false),
    /**
     * 可选 pollinations token（auth.pollinations.ai 免费注册即可）。
     * 匿名档限流紧、参数面窄；配了 token 才用得上 enhance/private/safe 与更多模型。
     */
    token: z.string().default(''),
    /** 默认是否把取回的图片存为附件（即默认显示真图）。 */
    attach: z.boolean().default(true),
    /**
     * 后端顺序。默认先 HF Space（FLUX.1-schnell，免密钥、**无水印**），
     * 失败再回退 pollinations 极简档（实测匿名可用、约 15s/条限流，但**图上有
     * pollinations.ai 水印**——该水印由上游服务端烧进像素，`nologo=true` 也去不掉，
     * 详见下面 nologo 字段说明）。
     * 可选值：'pollinations' | 'huggingface' | 'together'。
     */
    providers: z.array(z.string()).default(['pollinations', 'huggingface']),
    /** HF Space 后端（FLUX.1-schnell，免密钥、匿名排队）配置。 */
    huggingface: z.object({
        space: z.string().default('black-forest-labs/FLUX.1-schnell'),
        /** FLUX.1-schnell 只支持 1–8 步；步数越多越慢。 */
        steps: z.number().default(4),
    }),
    /**
     * Together.ai（OpenAI 兼容、Bearer key）后端。**有 key 时这是最稳的一条路**：
     * `black-forest-labs/FLUX.1-schnell-Free` 官方标注免费无限量（按请求限速）。
     * 免费注册 https://api.together.xyz 拿 key 填到 `together.key`，再把 'together'
     * 放进 providers 首位即可。key 为空时该后端自动跳过。
     */
    together: z.object({
        key: z.string().default(''),
        baseUrl: z.string().default('https://api.together.xyz/v1'),
        model: z.string().default('black-forest-labs/FLUX.1-schnell-Free'),
        steps: z.number().default(4),
    }),
    /**
     * 智谱 BigModel（CogView）后端 —— **国内不用加速器就能用的那条路**：
     * 域名 `open.bigmodel.cn` 直连可达（实测 401 = 通），注册送额度，
     * 其中 `cogview-3-flash` 是**免费模型**。
     *
     * 免费注册 https://open.bigmodel.cn → 拿 API key 填 `zhipu.key`，再把 'zhipu'
     * 放进 providers 首位。key 为空时该后端自动跳过。
     */
    zhipu: z.object({
        key: z.string().default(''),
        baseUrl: z.string().default('https://open.bigmodel.cn/api/paas/v4'),
        model: z.string().default('cogview-3-flash'),
    }),
    timeoutMs: z.number().default(60000),
    /**
     * 工具级总预算：默认 3 分钟，够"取图 + 落附件"这类正常调用，又短到
     * 上游挂住时能靠超时策略把回合交还给模型。(单后端取图预算见 timeoutMs)
     */
    toolTimeoutMs: z.number().default(180000),
});
/** attachments 只接受这四种；DSH 的参数/值 schema DSL 也按这四种声明。 */
const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
function asMediaType(value) {
    return typeof value === 'string' && MEDIA_TYPES.includes(value)
        ? value
        : undefined;
}
/** 正整数兜底。 */
function int(value, fallback) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
/** 文件名：从提示词取一个安全短句，便于在附件里辨认。 */
function fileName(prompt, mediaType) {
    const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : mediaType === 'image/gif' ? 'gif' : 'jpg';
    const slug = prompt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return `${slug === '' ? 'image' : slug}.${ext}`;
}
/**
 * 拼生图 URL：整套"魔力"就在这一段，prompt 必须整体 URL 编码。
 *
 * **只放非默认值的参数**：pollinations 的匿名免费面很窄——实测显式 width/height、
 * private=true、safe=true、enhance=true 都会把请求判到付费档而返回 402，
 * 只有极简 URL（`?model=flux&nologo=true`）稳定出图。所以：
 * 关闭的布尔与默认尺寸一律不写进 URL；`minimal` 用于降档重试时只留模型与去水印。
 */
function buildUrl(config, prompt, o) {
    const params = new URLSearchParams();
    const enhance = o.enhance ?? config.enhance;
    const safe = o.safe ?? config.safe;
    if (o.minimal !== true) {
        // 只在用户显式指定尺寸时带上（默认尺寸交给上游，等价于按需生成）。
        if (o.width !== config.width || o.height !== config.height) {
            params.set('width', String(o.width));
            params.set('height', String(o.height));
        }
        if (enhance)
            params.set('enhance', 'true');
        if (config.private)
            params.set('private', 'true');
        if (safe)
            params.set('safe', 'true');
    }
    params.set('model', o.model);
    if (config.nologo)
        params.set('nologo', 'true');
    if (typeof config.token === 'string' && config.token !== '')
        params.set('token', config.token);
    if (o.seed !== undefined)
        params.set('seed', String(o.seed));
    return `${config.endpoint}${encodeURIComponent(prompt)}?${params.toString()}`;
}
/** 上游当前免费档开放的模型（GET {endpoint 同源}/models）。失败返回空数组。 */
async function freeModels(endpoint, timeoutMs) {
    const base = endpoint.replace(/\/prompt\/?$/, '');
    try {
        const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(Math.min(timeoutMs, 10000)) });
        if (!res.ok)
            return [];
        const list = await res.json();
        return Array.isArray(list) ? list.filter((m) => typeof m === 'string') : [];
    }
    catch {
        return [];
    }
}
/**
 * pollinations 后端取图：先按配置档位；失败则沿"极简档位 → 换模型极简档位"降档重试。
 *
 * 背景（2026-10 实测）：pollinations 的免费面很窄——显式 width/height、private=true、
 * safe=true、enhance=true 都会被判到付费档（402 "Insufficient balance"）；
 * 只有极简 URL（`?model=flux&nologo=true`）能出图，且同一 IP 约 15s 才允许一条。
 * 因此它只作为回退后端（默认后端是 HF Space）。
 */
async function fetchFromPollinations(config, prompt, o, timeoutMs) {
    const upstream = await freeModels(config.endpoint, timeoutMs);
    // 已知可用候选：flux 为 2026-10 实测匿名档唯一稳定出图的模型；上游 /models 名单优先。
    const candidates = [...upstream, 'flux', 'turbo', 'sana'].filter((m, i, all) => typeof m === 'string' && m !== '' && all.indexOf(m) === i);
    const strategies = [];
    const push = (label, model, enhance, safe, minimal) => {
        if (strategies.some((s) => s.model === model && s.enhance === enhance && s.safe === safe && s.minimal === minimal))
            return;
        strategies.push({ label, model, enhance, safe, minimal });
    };
    // 阶梯只留两档，且**极简档位优先**：pollinations 匿名档的核心约束是「同一 IP 约 15s 只放一条」，
    // 在几秒内连打多档只会让每一条都吃 402（实测：4 档阶梯反而全灭，单发极简稳定 200）。
    // 第 1 档 = 极简（model + nologo，实测唯一稳定出图的形态）；第 2 档 = 换一个免费模型。
    push('极简档位', o.model, false, false, true);
    for (const model of candidates) {
        if (model === o.model)
            continue;
        push(`极简档位+${model}`, model, false, false, true);
    }
    const planned = strategies.slice(0, 2);
    let firstNote;
    const failures = [];
    for (const [index, strategy] of planned.entries()) {
        // 重试前等 16s：跨过匿名档的 15s 限流窗口，否则重试注定也是 402。
        if (index > 0)
            await new Promise((resolve) => setTimeout(resolve, 16000));
        const url = buildUrl(config, prompt, {
            ...o,
            model: strategy.model,
            enhance: strategy.enhance,
            safe: strategy.safe,
            minimal: strategy.minimal,
        });
        let response;
        try {
            response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        }
        catch (error) {
            const why = `异常 ${error instanceof Error ? error.message : String(error)}`;
            firstNote ??= why;
            failures.push(`${strategy.label}:${why}`);
            continue;
        }
        if (!response.ok) {
            firstNote ??= `HTTP ${response.status}`;
            failures.push(`${strategy.label}:HTTP ${response.status}`);
            // 402/401 = 档位不够（换免费模型），429/5xx = 上游抖动（同样值得再试一档）。
            continue;
        }
        const declared = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
        const mediaType = asMediaType(declared === '' ? 'image/jpeg' : declared);
        if (mediaType === undefined) {
            firstNote ??= `content-type ${declared || '未知'} 不受支持`;
            failures.push(`${strategy.label}:content-type ${declared || '未知'}`);
            continue;
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength === 0) {
            firstNote ??= '接口返回空内容';
            failures.push(`${strategy.label}:空内容`);
            continue;
        }
        return {
            data,
            mediaType,
            url,
            model: strategy.model,
            strategy: strategy.label,
            ...(firstNote === undefined ? {} : { note: firstNote }),
        };
    }
    // 402/401 居多说明是档位/限流问题，而非上游宕机——错误里给出可执行的下一步。
    const gated = failures.filter((f) => f.includes('402') || f.includes('401')).length;
    const hint = gated >= Math.ceil(planned.length / 2)
        ? '（多为匿名档限制：限流约 15s/条、参数/模型超出免费面即 402）'
        : '（上游服务异常，稍后重试）';
    throw new Error(`pollinations ${planned.length} 种档位全部未成 ${hint}；尝试明细：${failures.join('；')}`);
}
/**
 * HF Space 主机名：`owner/name` → `owner-name.hf.space`。
 * 注意域名里除了连字符不能有其它符号——`FLUX.1-schnell` 会变成 `flux-1-schnell`
 * （点号保留会解析失败，实测踩过）。
 */
function spaceHost(space) {
    return `${space.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.hf.space`;
}
/**
 * HF Space 后端取图（可选后端）：走 gradio_api 的 /call/{api} + SSE 轮询，最后取回文件字节。
 * 免密钥、按 Space 队列排队；实测 FLUX.1-schnell 4 步 1024×1024 约 5s 出图（WebP）。
 */
async function fetchFromHuggingFace(config, prompt, o, timeoutMs) {
    // 先探一下 huggingface.co 到底通不通。
    //
    // 为什么值得多这一下：国内网络（实测）`huggingface.co` 是**直接超时**的 ——
    // 不探的话每次生成都要先白等一整个 timeout（默认 60 秒）才轮到下一个后端，
    // 用户体感就是"点一下生图要等一分钟"。探不通就**当场跳过**，并且记住一段时间，
    // 后面几次连这一下都省了。
    if (Date.now() < hfBlockedUntil) {
        throw new Error('huggingface.co 之前连不上（已记住，稍后再试）');
    }
    try {
        await fetch('https://huggingface.co/', { method: 'HEAD', signal: AbortSignal.timeout(HF_PROBE_MS) });
    }
    catch (error) {
        hfBlockedUntil = Date.now() + HF_BLOCKED_MEMO_MS;
        throw new Error(`huggingface.co 连不上（${error instanceof Error ? error.message : String(error)}），本次跳过`);
    }
    const space = typeof config.huggingface?.space === 'string' && config.huggingface.space !== ''
        ? config.huggingface.space
        : 'black-forest-labs/FLUX.1-schnell';
    const base = `https://${spaceHost(space)}/gradio_api`;
    const strategy = `HF ${space}`;
    const steps = Math.min(8, Math.max(1, Math.round(config.huggingface?.steps ?? 4)));
    const seed = o.seed ?? 0;
    const deadline = Date.now() + timeoutMs;
    const signal = AbortSignal.timeout(timeoutMs);
    const post = await fetch(`${base}/call/infer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: [prompt, seed, seed === 0, o.width, o.height, steps] }),
        signal,
    });
    if (!post.ok)
        throw new Error(`HTTP ${post.status}（${(await post.text().catch(() => '')).slice(0, 120)}）`);
    const { event_id: eventId } = (await post.json());
    if (typeof eventId !== 'string' || eventId === '')
        throw new Error('未拿到 event_id');
    // SSE 轮询：以 timeoutMs 为总预算，避免 Space 排队时无限等待。
    let imageUrl;
    while (Date.now() < deadline) {
        const res = await fetch(`${base}/call/infer/${eventId}`, { signal: AbortSignal.timeout(20000) });
        const text = await res.text();
        if (text.includes('event: error'))
            throw new Error('Space 返回 error 事件（可能排队失败或超限）');
        if (text.includes('event: complete')) {
            const dataLine = text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? '[]';
            const parsed = JSON.parse(dataLine);
            imageUrl = parsed.find((item) => typeof item?.url === 'string')?.url;
            if (imageUrl === undefined)
                throw new Error('完成事件里没有图片 URL');
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (imageUrl === undefined)
        throw new Error('等待 Space 出图超时');
    const file = await fetch(imageUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!file.ok)
        throw new Error(`取回图片失败 HTTP ${file.status}`);
    const declared = (file.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const mediaType = asMediaType(declared === '' ? 'image/webp' : declared);
    if (mediaType === undefined)
        throw new Error(`Space 返回的 ${declared || '未知'} 不受支持`);
    const data = new Uint8Array(await file.arrayBuffer());
    if (data.byteLength === 0)
        throw new Error('Space 返回空图片');
    return { data, mediaType, url: imageUrl, model: `flux-schnell(${space})`, strategy };
}
/**
 * 智谱 BigModel（CogView）后端：`POST {baseUrl}/images/generations`。
 *
 * 为什么单开一个后端、不复用 Together 那条"OpenAI 兼容"：
 * 智谱的**请求体不一样** —— 尺寸要 `size: "1024x1024"` 字符串，不吃 `width/height/steps/n/
 * response_format` 那些字段，硬套过去会被判非法。返回体倒是兼容（`data[0].url`）。
 *
 * 这条路对国内用户最实用：`open.bigmodel.cn` **直连可达**（实测 401 = 通，不需要加速器），
 * 注册送额度，`cogview-3-flash` 是免费模型。
 */
async function fetchFromZhipu(config, prompt, o, timeoutMs) {
    const key = typeof config.zhipu?.key === 'string' ? config.zhipu.key.trim() : '';
    if (key === '') {
        throw new Error('未配置 zhipu.key（https://open.bigmodel.cn 免费注册，送额度、cogview-3-flash 免费）');
    }
    const baseUrl = (config.zhipu?.baseUrl || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '');
    const model = config.zhipu?.model || 'cogview-3-flash';
    const strategy = `智谱 ${model}`;
    const res = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        // 智谱只要这三个字段（多塞会被判非法）。尺寸用 `1024x1024` 这种字符串格式。
        body: JSON.stringify({ model, prompt, size: `${o.width}x${o.height}` }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}（${(await res.text().catch(() => '')).slice(0, 160)}）`);
    const body = (await res.json());
    const first = body.data?.[0];
    if (first === undefined)
        throw new Error('响应里没有 data[0]');
    if (typeof first.url === 'string' && first.url !== '') {
        const file = await fetch(first.url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!file.ok)
            throw new Error(`取回图片失败 HTTP ${file.status}`);
        const declared = (file.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
        const mediaType = asMediaType(declared === '' ? 'image/png' : declared);
        if (mediaType === undefined)
            throw new Error(`返回的 ${declared || '未知'} 不受支持`);
        return { data: new Uint8Array(await file.arrayBuffer()), mediaType, url: first.url, model, strategy };
    }
    if (typeof first.b64_json === 'string' && first.b64_json !== '') {
        const data = new Uint8Array(Buffer.from(first.b64_json, 'base64'));
        if (data.byteLength === 0)
            throw new Error('base64 解码后为空');
        return { data, mediaType: 'image/png', url: `${baseUrl}/images/generations`, model, strategy };
    }
    throw new Error('响应里既没有 url 也没有 b64_json');
}
/**
 * Together.ai（OpenAI 兼容）后端取图：`POST {baseUrl}/images/generations`。
 * 返回体里的 `data[0].b64_json`（或 `url`）即图片。**有 key 时这是最稳的一条路**：
 * `black-forest-labs/FLUX.1-schnell-Free` 官方标注免费无限量（按请求限速）。
 */
async function fetchFromTogether(config, prompt, o, timeoutMs) {
    const key = typeof config.together?.key === 'string' ? config.together.key.trim() : '';
    if (key === '')
        throw new Error('未配置 together.key（免费注册 https://api.together.xyz 获取后填入插件配置）');
    const baseUrl = (config.together?.baseUrl || 'https://api.together.xyz/v1').replace(/\/+$/, '');
    const model = config.together?.model || 'black-forest-labs/FLUX.1-schnell-Free';
    const steps = Math.min(8, Math.max(1, Math.round(config.together?.steps ?? 4)));
    const strategy = `Together ${model}`;
    const res = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model,
            prompt,
            width: o.width,
            height: o.height,
            steps,
            n: 1,
            response_format: 'b64_json',
            ...(o.seed === undefined ? {} : { seed: o.seed }),
        }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}（${(await res.text().catch(() => '')).slice(0, 160)}）`);
    const body = (await res.json());
    const first = body.data?.[0];
    if (first === undefined)
        throw new Error('响应里没有 data[0]');
    if (typeof first.b64_json === 'string' && first.b64_json !== '') {
        const data = new Uint8Array(Buffer.from(first.b64_json, 'base64'));
        if (data.byteLength === 0)
            throw new Error('base64 解码后为空');
        return { data, mediaType: 'image/png', url: `${baseUrl}/images/generations`, model, strategy };
    }
    if (typeof first.url === 'string' && first.url !== '') {
        const file = await fetch(first.url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!file.ok)
            throw new Error(`取回图片失败 HTTP ${file.status}`);
        const declared = (file.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
        const mediaType = asMediaType(declared === '' ? 'image/jpeg' : declared);
        if (mediaType === undefined)
            throw new Error(`返回的 ${declared || '未知'} 不受支持`);
        return { data: new Uint8Array(await file.arrayBuffer()), mediaType, url: first.url, model, strategy };
    }
    throw new Error('响应里既没有 b64_json 也没有 url');
}
/**
 * 取图总入口：按配置的后端顺序依次尝试，全部失败才抛。
 * 每个后端的失败原因都会带进错误信息，便于判断是"档位/限流"还是"上游坏了"。
 */
async function fetchImage(config, prompt, o, timeoutMs) {
    const wanted = (Array.isArray(config.providers) ? config.providers : []).filter((p) => typeof p === 'string' && p !== '');
    const order = wanted.length > 0 ? wanted : ['pollinations', 'huggingface'];
    const failures = [];
    for (const [index, provider] of order.entries()) {
        // 后端之间也留一点间隔：pollinations 限流时立刻换家反而更稳（各家队列独立）。
        if (index > 0)
            await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
            if (provider === 'zhipu')
                return await fetchFromZhipu(config, prompt, o, timeoutMs);
            if (provider === 'together')
                return await fetchFromTogether(config, prompt, o, timeoutMs);
            if (provider === 'huggingface')
                return await fetchFromHuggingFace(config, prompt, o, timeoutMs);
            if (provider === 'pollinations')
                return await fetchFromPollinations(config, prompt, o, timeoutMs);
            failures.push(`${provider}: 未知后端`);
        }
        catch (error) {
            failures.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(`image_generate: 取图失败，${order.length} 个后端均未成；明细：${failures.join('；')}` +
        '（要稳定出图：国内推荐智谱 cogview-3-flash（https://open.bigmodel.cn 免费注册，' +
        'key 填 zhipu.key、providers 设 ["zhipu"]）；有加速器可用 together.key；或稍后重试）');
}
/* --------------------------------------------------- 本地配置文件（可选但推荐） */
/**
 * `~/.dsh/image-gen.json`：**不用改 profile 组合、不用重启**就能覆盖下面的配置。
 *
 * 为什么要有它：想稳定出图得填 Together.ai 的 key，而"编辑 `cordis.patch.yml` 里的 YAML"
 * 对非技术用户是道硬门槛（缩进错一格整个 profile 都起不来）。这里改成给一个 JSON 文件：
 * **第一次调用工具时自动生成模板**，填进去下一次出图就生效。
 *
 * 键名与组合配置一致；嵌套的 `together` / `huggingface` 做浅合并
 * （只写 `together.key` 也能生效，不必把 baseUrl/model 抄一遍）。
 */
const LOCAL_CONFIG_FILE = 'image-gen.json';
/** 允许被本地文件覆盖的键。`toolTimeoutMs` 故意不在内：工具超时必须在注册时就定下来。 */
const LOCAL_KEYS = new Set([
    'endpoint', 'width', 'height', 'model', 'enhance', 'private', 'nologo', 'token',
    'providers', 'huggingface', 'together', 'zhipu', 'attach', 'timeoutMs',
]);
const LOCAL_TEMPLATE = `${JSON.stringify({
    _说明: '这个文件覆盖插件的默认配置；改完【下一次出图就生效】，不用重启 DSH。',
    _国内最稳: '去 https://open.bigmodel.cn 免费注册（送额度，cogview-3-flash 免费）→ key 填进 zhipu.key → providers 改成 ["zhipu"]。不用加速器。',
    _有加速器: '去 https://api.together.xyz 免费注册拿 key → 填进 together.key → providers 改成 ["together"]（1-3 秒出图）。',
    _pollinations_token: 'https://gen.pollinations.ai 免费注册拿 token 填进 token，比匿名档稳（匿名约 15 秒一条）。',
    providers: ['pollinations', 'huggingface'],
    zhipu: { key: '' },
    together: { key: '' },
    token: '',
    model: 'flux',
    width: 1024,
    height: 1024,
    attach: true,
    timeoutMs: 60000,
}, null, 2)}\n`;
function dshHome() {
    const home = process.env.DSH_HOME;
    return home !== undefined && home !== '' ? home : join(homedir(), '.dsh');
}
/** 探 huggingface.co 的超时（短一点：它只回答"通不通"，不干活）。 */
const HF_PROBE_MS = 4000;
/** 探到连不上之后，多久之内不再去试（免得每次生成都白等这一下）。 */
const HF_BLOCKED_MEMO_MS = 10 * 60 * 1000;
/** 进程内记住"HF 暂时连不上"的时刻。 */
let hfBlockedUntil = 0;
/**
 * 读本地覆盖配置；文件不存在就顺手写一份模板（让人知道有这么个地方、key 该填哪儿）。
 * @returns 合成后的配置 + 一句该说给人听的话（只在该说的时候非空）。
 */
async function withLocalConfig(base) {
    const file = join(dshHome(), LOCAL_CONFIG_FILE);
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch {
        try {
            await mkdir(dshHome(), { recursive: true });
            await writeFile(file, LOCAL_TEMPLATE, 'utf8');
            return {
                config: base,
                note: `已生成配置文件 ${file} —— 想稳定出图就在这里填 together.key，并把 providers 改成 ["together"]`,
            };
        }
        catch {
            return { config: base, note: '' };
        }
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        return {
            config: base,
            note: `配置文件 ${file} 不是合法 JSON，本次已忽略（${error instanceof Error ? error.message : String(error)}）`,
        };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { config: base, note: `配置文件 ${file} 顶层必须是对象，本次已忽略` };
    }
    const merged = { ...base };
    const unknownKeys = [];
    for (const [key, value] of Object.entries(parsed)) {
        if (key.startsWith('_'))
            continue;
        if (LOCAL_KEYS.has(key) === false) {
            unknownKeys.push(key);
            continue;
        }
        if (value === undefined || value === null)
            continue;
        if (key === 'together' || key === 'huggingface' || key === 'zhipu') {
            if (typeof value !== 'object' || Array.isArray(value)) {
                unknownKeys.push(key);
                continue;
            }
            merged[key] = { ...base[key], ...value };
            continue;
        }
        merged[key] = value;
    }
    return {
        config: merged,
        note: unknownKeys.length === 0 ? '' : `配置文件 ${file} 里有不认识的键（已忽略）：${unknownKeys.join(', ')}`,
    };
}
export function apply(ctx, config) {
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'image_generate',
        description: '按提示词生成一张图片并直接显示。提示词请用英文且尽量具体（工具只做 URL 编码，不改写）。',
        // 协作式超时的声明口：不声明 = 上游挂住时整轮被冻死（曾经真实发生过）。
        timeoutMs: int(config.toolTimeoutMs, 180000),
        parameters: {
            prompt: { type: 'string', required: true, description: '英文提示词' },
            width: { type: 'integer', description: '宽（默认取插件配置）' },
            height: { type: 'integer', description: '高（默认取插件配置）' },
            model: { type: 'string', description: '模型名，如 flux / turbo' },
            seed: { type: 'integer', description: '固定种子以便复现同一张图' },
            attach: { type: 'boolean', description: '是否取回图片并作为附件显示（默认 true）' },
        },
        output: {
            // DSH 的值 schema DSL：required 是「属性级布尔」，不是 JSON-Schema 的 required 数组。
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    url: { type: 'string', required: true },
                    markdown: { type: 'string', required: true },
                    model: { type: 'string', required: true },
                    size: { type: 'string', required: true },
                    /** 仅当发生降档重试时出现：说明首次失败原因与最终生效档位。 */
                    note: { type: 'string' },
                    image: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            attachmentId: { type: 'string', required: true },
                            mediaType: { type: 'string', enum: MEDIA_TYPES, required: true },
                            bytes: { type: 'integer', required: true },
                            width: { type: 'integer', required: true },
                            height: { type: 'integer', required: true },
                            name: { type: 'string' },
                        },
                    },
                },
            },
            render(_args, value) {
                const out = value;
                const lines = [
                    out.markdown,
                    '',
                    `<url>${out.url}</url>`,
                    `<model>${out.model}</model>`,
                    `<size>${out.size}</size>`,
                ];
                if (out.image === undefined)
                    lines.push('<attached>false</attached>');
                // note 要真的显示出来：它是"配置文件生成了/写错了""降档重试了"的唯一出口，
                // 只塞进返回值不渲染，等于没说。
                if (typeof out.note === 'string' && out.note !== '')
                    lines.push('', `<note>${out.note}</note>`);
                const blocks = [{ type: 'text', text: lines.join('\n') }];
                if (out.image !== undefined)
                    blocks.push({ type: 'image', attachment: out.image });
                return blocks;
            },
        },
        async execute(args) {
            // 每次调用都读一遍本地覆盖文件：改完**下一次出图就生效**，不用重启、不用重载插件。
            const local = await withLocalConfig(config);
            const cfg = local.config;
            const prompt = String(args.prompt ?? '').trim();
            if (prompt === '')
                throw new Error('image_generate: prompt 不能为空');
            const width = int(args.width, int(cfg.width, 1920));
            const height = int(args.height, int(cfg.height, 1080));
            const model = typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : cfg.model;
            const seedValue = args.seed === undefined ? undefined : int(args.seed, 0);
            const seed = seedValue === 0 ? undefined : seedValue;
            const wantAttach = args.attach === undefined ? cfg.attach : args.attach !== false;
            // 已声明 inject attachments，正常一定在；再取一次是为了极端组合下降级为"只给直链"。
            const attachments = ctx.get('attachments');
            // 不取图：只回 markdown + 直链（零字节下载，也让上游按需生成）。
            if (!wantAttach || attachments === undefined) {
                const url = buildUrl(cfg, prompt, { width, height, model, seed });
                return {
                    url,
                    markdown: `![image](${url})`,
                    model,
                    size: `${width}x${height}`,
                    ...(local.note === '' ? {} : { note: local.note }),
                };
            }
            const fetched = await fetchImage(cfg, prompt, { width, height, model, seed }, int(cfg.timeoutMs, 60000));
            const { data, mediaType } = fetched;
            const allowed = attachments.imageLimits?.mediaTypes ?? [];
            if (allowed.length > 0 && !allowed.includes(mediaType)) {
                throw new Error(`image_generate: 本部署不接受 ${mediaType}，仅接受 ${allowed.join(', ')}`);
            }
            const [saved] = await attachments.saveImages([{ data, mediaType, name: fileName(prompt, mediaType) }]);
            const ref = saved;
            const storedType = asMediaType(ref.mediaType);
            if (storedType === undefined)
                throw new Error('image_generate: 附件服务返回了未知的图片类型');
            const image = {
                attachmentId: AttachmentId(String(ref.attachmentId)),
                mediaType: storedType,
                // bytes 是 ImageAttachmentRef 的必填字段，也是输出 schema 的必填项：
                // 漏掉它 defineTool 的输出校验会直接判非法（missing required property "value.image.bytes"）。
                bytes: int(ref.bytes, data.byteLength),
                width: int(ref.width, width),
                height: int(ref.height, height),
            };
            if (typeof ref.name === 'string')
                image.name = ref.name;
            const notes = [
                local.note,
                fetched.note === undefined ? '' : `已降档重试（${fetched.strategy}）；首次请求：${fetched.note}`,
            ].filter((entry) => entry !== '');
            return {
                url: fetched.url,
                markdown: `![image](${fetched.url})`,
                model: fetched.model,
                size: `${width}x${height}`,
                image,
                ...(notes.length === 0 ? {} : { note: notes.join('；') }),
            };
        },
    })), '@dsh-external/dsh-plugin-image-gen: image_generate tool');
}
//# sourceMappingURL=index.js.map