/**
 * 去掉智谱 CogView 右下角的「AI生成」水印（本地像素处理）。
 *
 * 为什么要在本地做：官方的 `watermark_enabled: false` **实测无效** —— 2026-10-08 用同一个
 * key 发 `{"watermark_enabled": false}`，回来的文件名照样是 `..._watermark.png`，像素上也
 * 照样有那个角标。免费档这条路只能在**本地**走。
 *
 * 水印的实际范围（1024×1024 实测，放大 3 倍量的）：圆角胶囊 x 841–1014、y 946–1014，
 * 外面还有一圈很淡的光晕（上边缘约到 y≈922）。所以按**右下角 20%×10%** 取框足够稳。
 *
 * 算法要点（踩过的坑都写在实现里）：
 *   1. 不用"搬一块别的区域盖上去"：上方带 / 水平镜像都试过，任何"搬一块"都会在边界留下
 *      硬接缝（背景稍有渐变就看得出一条边）。
 *   2. 用**扩散修补**：边界值就是原图边界值，框内解成平滑过渡，天然没有接缝。
 *   3. 必须**多尺度（金字塔）**：单尺度松弛在 200px 宽的框上要 O(N²) 轮才收敛，跑几百轮
 *      的结果是"框里平掉了、和周围渐变对不上"（一块高原）。粗尺度先解大趋势、逐级细化，
 *      又快又真的调和（harmonic）。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
/**
 * 找 sharp：本包 node_modules（build-local 会挂 junction）→ dsh 安装/源码目录。
 * 找不到就抛 —— 调用方按"去不掉水印但图照出"处理，不能因为一个可选能力让生图整体失败。
 */
export function loadSharp() {
    const candidates = [
        process.env.DSH_DEPS,
        process.env.DSH_CHECKOUT === undefined ? undefined : join(process.env.DSH_CHECKOUT, 'node_modules'),
        'D:/dsh/dsh-pinned/node_modules',
        process.env.USERPROFILE === undefined ? undefined : join(process.env.USERPROFILE, 'dsh-harness/node_modules'),
    ].filter((entry) => typeof entry === 'string' && entry !== '');
    const errors = [];
    for (const root of candidates) {
        try {
            const require = createRequire(join(root, 'noop.js'));
            return require('sharp');
        }
        catch (error) {
            errors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    try {
        return createRequire(import.meta.url)('sharp');
    }
    catch (error) {
        errors.push(`本包: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new Error(`找不到 sharp（${errors.join('；')}）`);
}
/** 水印框（按图片尺寸等比缩放）。实测 1024×1024 → 左上 (819, 922)，205×102。 */
export function watermarkBox(width, height) {
    return {
        left: Math.round(width * 0.8),
        top: Math.round(height * 0.9),
        width: Math.round(width * 0.2),
        height: Math.round(height * 0.1),
    };
}
/** 一轮松弛：只动"未知"像素，取四点平均；贴边处用自身当邻居（Neumann）。 */
function relaxLevel(level, passes) {
    const { W, H, values, known } = level;
    const C = values.length / (W * H);
    const at = (x, y) => (y * W + x) * C;
    for (let pass = 0; pass < passes; pass += 1) {
        for (let y = 0; y < H; y += 1) {
            for (let x = 0; x < W; x += 1) {
                const index = y * W + x;
                if (known[index] === 1)
                    continue;
                const center = at(x, y);
                const up = y - 1 >= 0 ? at(x, y - 1) : center;
                const down = y + 1 < H ? at(x, y + 1) : center;
                const left = x - 1 >= 0 ? at(x - 1, y) : center;
                const right = x + 1 < W ? at(x + 1, y) : center;
                for (let c = 0; c < C; c += 1) {
                    values[center + c] = (values[up + c] + values[down + c] + values[left + c] + values[right + c]) / 4;
                }
            }
        }
    }
}
/** 未知像素先填成"已知像素的均值"：不然粗尺度上整块空白是黑的，往上采样会带出黑斑。 */
function seedUnknown(level) {
    const { W, H, values, known } = level;
    const C = values.length / (W * H);
    const sum = new Float64Array(C);
    let count = 0;
    for (let index = 0; index < W * H; index += 1) {
        if (known[index] === 0)
            continue;
        count += 1;
        for (let c = 0; c < C; c += 1)
            sum[c] = (sum[c] ?? 0) + (values[index * C + c] ?? 0);
    }
    if (count === 0)
        return;
    for (let index = 0; index < W * H; index += 1) {
        if (known[index] === 1)
            continue;
        for (let c = 0; c < C; c += 1)
            values[index * C + c] = (sum[c] ?? 0) / count;
    }
}
/** 在框内做多尺度扩散修补，返回可直接 composite 的 PNG 与位置。 */
async function inpaintBox(sharp, input, target, imageSize) {
    const pad = 2;
    // 水印框本来就贴着右下角，加 pad 会超出画布 —— 先把区域裁到画布内。
    const left = Math.max(0, target.left - pad);
    const top = Math.max(0, target.top - pad);
    const right = Math.min(imageSize.width, target.left + target.width + pad);
    const bottom = Math.min(imageSize.height, target.top + target.height + pad);
    const W = right - left;
    const H = bottom - top;
    const { data, info } = await sharp(input).extract({ left, top, width: W, height: H }).removeAlpha().raw()
        .toBuffer({ resolveWithObject: true });
    const C = info.channels;
    const x0 = target.left - left;
    const y0 = target.top - top;
    const x1 = Math.min(W, target.left + target.width - left);
    const y1 = Math.min(H, target.top + target.height - top);
    const values = new Float32Array(W * H * C);
    for (let i = 0; i < values.length; i += 1)
        values[i] = data[i] ?? 0;
    const known = new Uint8Array(W * H).fill(1);
    for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1)
            known[y * W + x] = 0;
    }
    const levels = [{ W, H, values, known }];
    // 建金字塔：未知像素不参与平均；一块全未知就保持未知，等粗尺度解出来再填。
    while ((levels[levels.length - 1]?.W ?? 0) > 8 && (levels[levels.length - 1]?.H ?? 0) > 8) {
        const prev = levels[levels.length - 1];
        const w2 = Math.max(1, Math.ceil(prev.W / 2));
        const h2 = Math.max(1, Math.ceil(prev.H / 2));
        const v2 = new Float32Array(w2 * h2 * C);
        const k2 = new Uint8Array(w2 * h2);
        for (let y = 0; y < h2; y += 1) {
            for (let x = 0; x < w2; x += 1) {
                const sum = new Float64Array(C);
                let count = 0;
                for (let dy = 0; dy < 2; dy += 1) {
                    for (let dx = 0; dx < 2; dx += 1) {
                        const sx = x * 2 + dx;
                        const sy = y * 2 + dy;
                        if (sx >= prev.W || sy >= prev.H)
                            continue;
                        const source = sy * prev.W + sx;
                        if (prev.known[source] === 0)
                            continue;
                        count += 1;
                        for (let c = 0; c < C; c += 1)
                            sum[c] = (sum[c] ?? 0) + (prev.values[source * C + c] ?? 0);
                    }
                }
                if (count === 0)
                    continue;
                const index = y * w2 + x;
                k2[index] = 1;
                for (let c = 0; c < C; c += 1)
                    v2[index * C + c] = (sum[c] ?? 0) / count;
            }
        }
        levels.push({ W: w2, H: h2, values: v2, known: k2 });
    }
    // 粗 → 细：粗尺度先解（此时未知区已经很小，很快收敛），再逐级上采样细化。
    for (let index = levels.length - 1; index >= 0; index -= 1) {
        const level = levels[index];
        if (index < levels.length - 1) {
            const coarse = levels[index + 1];
            for (let y = 0; y < level.H; y += 1) {
                for (let x = 0; x < level.W; x += 1) {
                    const fine = y * level.W + x;
                    if (level.known[fine] === 1)
                        continue;
                    const cx = Math.min(coarse.W - 1, Math.floor(x / 2));
                    const cy = Math.min(coarse.H - 1, Math.floor(y / 2));
                    const source = (cy * coarse.W + cx) * C;
                    for (let c = 0; c < C; c += 1)
                        level.values[fine * C + c] = coarse.values[source + c] ?? 0;
                }
            }
        }
        else {
            seedUnknown(level);
        }
        relaxLevel(level, index === 0 ? 600 : 120);
    }
    const out = Buffer.alloc(W * H * C);
    for (let i = 0; i < out.length; i += 1) {
        const value = Math.round(values[i] ?? 0);
        out[i] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
    const patch = await sharp(out, { raw: { width: W, height: H, channels: C } }).png().toBuffer();
    return { patch, left, top };
}
/**
 * 去掉一张图的水印，返回 JPEG 字节。图不是 JPEG（或没有水印）也无所谓 —— 调用方按需使用。
 * 抛错时调用方应保留原图（去水印是可选增强，不该让生图失败）。
 */
export async function dewatermark(input, options = {}) {
    const sharp = loadSharp();
    const { mode = 'inpaint', quality = 95 } = options;
    const meta = await sharp(input).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width === 0 || height === 0)
        throw new Error('读不出图片尺寸');
    if (mode === 'crop') {
        const cropped = Math.round(height * 0.895);
        return sharp(input).extract({ left: 0, top: 0, width, height: cropped }).jpeg({ quality }).toBuffer();
    }
    const target = options.box ?? watermarkBox(width, height);
    const { patch, left, top } = await inpaintBox(sharp, input, target, { width, height });
    return sharp(input).composite([{ input: patch, left, top }]).jpeg({ quality }).toBuffer();
}
//# sourceMappingURL=dewatermark.js.map