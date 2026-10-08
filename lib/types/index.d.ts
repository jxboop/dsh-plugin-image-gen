import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "@dsh-external/dsh-plugin-image-gen";
export declare const inject: string[];
export interface Config {
    endpoint: string;
    width: number;
    height: number;
    model: string;
    enhance: boolean;
    private: boolean;
    nologo: boolean;
    /** 出图后本地抹掉智谱的「AI生成」角标（官方 watermark_enabled:false 实测无效）。 */
    removeWatermark: boolean;
    safe: boolean;
    /** 可选 pollinations token（空字符串 = 匿名档）。 */
    token: string;
    /** 后端顺序（'zhipu' | 'together' | 'huggingface' | 'pollinations'）。 */
    providers: string[];
    /** HF Space 后端配置。 */
    huggingface: {
        space: string;
        steps: number;
    };
    /** Together.ai（OpenAI 兼容）后端配置。 */
    together: {
        key: string;
        baseUrl: string;
        model: string;
        steps: number;
    };
    /** 智谱 BigModel（CogView）后端配置：国内直连可用，注册送额度，cogview-3-flash 免费。 */
    zhipu: {
        key: string;
        baseUrl: string;
        model: string;
    };
    attach: boolean;
    timeoutMs: number;
    /**
     * 工具调用总预算（毫秒）。DSH 的超时是**协作式**的：工具自己不返回，
     * 宿主救不了，整轮（乃至整个会话）会被冻住。声明 timeoutMs 之后，
     * 超时由 `dsh-tool-call-timeout-policy` 接管：返回一条 "tool call timed out"
     * 的工具结果，回合继续走完。
     */
    toolTimeoutMs: number;
}
export declare const Config: z<Schemastery.ObjectS<{
    /** 生图接口前缀，prompt 以 URL 编码追加在其后。 */
    endpoint: z<string, string>;
    /**
     * 默认尺寸。取 1024×1024 = pollinations 上游自身的默认值——显式写 width/height
     * 在匿名档会被判到付费面（402），所以默认尺寸下干脆不写进 URL，报出的尺寸即上游默认。
     */
    width: z<number, number>;
    height: z<number, number>;
    /**
     * 默认模型。实测（2026-10）匿名档唯一稳定可用的是极简 URL + `model=flux`：
     * sana/turbo 会 402（"Insufficient balance"），flux 极简可出图。
     */
    model: z<string, string>;
    /**
     * 提示词增强。**默认 false**：enhance=true 属付费面，匿名请求会 402，故默认关闭。
     */
    enhance: z<boolean, boolean>;
    /**
     * private=true 在匿名档会整体落到付费判定（实测 402），**默认 false**；
     * 有 token 的部署可打开。注意：关闭后生成的图会出现在 pollinations 公共 feed 里。
     */
    private: z<boolean, boolean>;
    /**
     * 传给 pollinations 的 `nologo` 参数。⚠️ 实测（2026-10）它**去不掉水印**：
     * 免费匿名档的 pollinations.ai 水印由上游服务端烧进像素，带不带 nologo 都在。
     * 想要无水印图只能换后端（默认已改为 huggingface / 或配 together.key）。
     */
    nologo: z<boolean, boolean>;
    /**
     * 出图后**本地抹掉智谱右下角的「AI生成」角标**（默认开）。
     *
     * 为什么必须本地做：官方请求体里的 `watermark_enabled: false` **实测无效** ——
     * 2026-10-08 用同一个 key 发过，回来的文件名照旧 `..._watermark.png`、像素上照旧有角标。
     * 现在的做法是像素级扩散修补（`src/dewatermark.ts`）：把右下角 20%×10% 的区域用四周
     * 真实像素当边界重新解出来，没有硬接缝。约 0.8 秒/张；失败只记 note，不让生图失败。
     *
     * 想保留角标（例如要公开传播 AI 内容、需要显式标识）就把这项设成 false。
     */
    removeWatermark: z<boolean, boolean>;
    /**
     * 安全过滤。**默认 false**：实测 safe=true 会被判到付费面返回 402，
     * 故默认关闭以免工具整体不可用；需要严格过滤时再手动打开。
     */
    safe: z<boolean, boolean>;
    /**
     * 可选 pollinations token（auth.pollinations.ai 免费注册即可）。
     * 匿名档限流紧、参数面窄；配了 token 才用得上 enhance/private/safe 与更多模型。
     */
    token: z<string, string>;
    /** 默认是否把取回的图片存为附件（即默认显示真图）。 */
    attach: z<boolean, boolean>;
    /**
     * 后端顺序。默认先 HF Space（FLUX.1-schnell，免密钥、**无水印**），
     * 失败再回退 pollinations 极简档（实测匿名可用、约 15s/条限流，但**图上有
     * pollinations.ai 水印**——该水印由上游服务端烧进像素，`nologo=true` 也去不掉，
     * 详见下面 nologo 字段说明）。
     * 可选值：'pollinations' | 'huggingface' | 'together'。
     */
    providers: z<string[], string[]>;
    /** HF Space 后端（FLUX.1-schnell，免密钥、匿名排队）配置。 */
    huggingface: z<Schemastery.ObjectS<{
        space: z<string, string>;
        /** FLUX.1-schnell 只支持 1–8 步；步数越多越慢。 */
        steps: z<number, number>;
    }>, Schemastery.ObjectT<{
        space: z<string, string>;
        /** FLUX.1-schnell 只支持 1–8 步；步数越多越慢。 */
        steps: z<number, number>;
    }>>;
    /**
     * Together.ai（OpenAI 兼容、Bearer key）后端。**有 key 时这是最稳的一条路**：
     * `black-forest-labs/FLUX.1-schnell-Free` 官方标注免费无限量（按请求限速）。
     * 免费注册 https://api.together.xyz 拿 key 填到 `together.key`，再把 'together'
     * 放进 providers 首位即可。key 为空时该后端自动跳过。
     */
    together: z<Schemastery.ObjectS<{
        key: z<string, string>;
        baseUrl: z<string, string>;
        model: z<string, string>;
        steps: z<number, number>;
    }>, Schemastery.ObjectT<{
        key: z<string, string>;
        baseUrl: z<string, string>;
        model: z<string, string>;
        steps: z<number, number>;
    }>>;
    /**
     * 智谱 BigModel（CogView）后端 —— **国内不用加速器就能用的那条路**：
     * 域名 `open.bigmodel.cn` 直连可达（实测 401 = 通），注册送额度，
     * 其中 `cogview-3-flash` 是**免费模型**。
     *
     * 免费注册 https://open.bigmodel.cn → 拿 API key 填 `zhipu.key`，再把 'zhipu'
     * 放进 providers 首位。key 为空时该后端自动跳过。
     */
    zhipu: z<Schemastery.ObjectS<{
        key: z<string, string>;
        baseUrl: z<string, string>;
        model: z<string, string>;
    }>, Schemastery.ObjectT<{
        key: z<string, string>;
        baseUrl: z<string, string>;
        model: z<string, string>;
    }>>;
    timeoutMs: z<number, number>;
    /**
     * 工具级总预算：默认 3 分钟，够"取图 + 落附件"这类正常调用，又短到
     * 上游挂住时能靠超时策略把回合交还给模型。(单后端取图预算见 timeoutMs)
     */
    toolTimeoutMs: z<number, number>;
}>, Schemastery.ObjectT<{
    /** 生图接口前缀，prompt 以 URL 编码追加在其后。 */
    endpoint: z<string, string>;
    /**
     * 默认尺寸。取 1024×1024 = pollinations 上游自身的默认值——显式写 width/height
     * 在匿名档会被判到付费面（402），所以默认尺寸下干脆不写进 URL，报出的尺寸即上游默认。
     */
    width: z<number, number>;
    height: z<number, number>;
    /**
     * 默认模型。实测（2026-10）匿名档唯一稳定可用的是极简 URL + `model=flux`：
     * sana/turbo 会 402（"Insufficient balance"），flux 极简可出图。
     */
    model: z<string, string>;
    /**
     * 提示词增强。**默认 false**：enhance=true 属付费面，匿名请求会 402，故默认关闭。
     */
    enhance: z<boolean, boolean>;
    /**
     * private=true 在匿名档会整体落到付费判定（实测 402），**默认 false**；
     * 有 token 的部署可打开。注意：关闭后生成的图会出现在 pollinations 公共 feed 里。
     */
    private: z<boolean, boolean>;
    /**
     * 传给 pollinations 的 `nologo` 参数。⚠️ 实测（2026-10）它**去不掉水印**：
     * 免费匿名档的 pollinations.ai 水印由上游服务端烧进像素，带不带 nologo 都在。
     * 想要无水印图只能换后端（默认已改为 huggingface / 或配 together.key）。
     */
    nologo: z<boolean, boolean>;
    /**
     * 出图后**本地抹掉智谱右下角的「AI生成」角标**（默认开）。
     *
     * 为什么必须本地做：官方请求体里的 `watermark_enabled: false` **实测无效** ——
     * 2026-10-08 用同一个 key 发过，回来的文件名照旧 `..._watermark.png`、像素上照旧有角标。
     * 现在的做法是像素级扩散修补（`src/dewatermark.ts`）：把右下角 20%×10% 的区域用四周
     * 真实像素当边界重新解出来，没有硬接缝。约 0.8 秒/张；失败只记 note，不让生图失败。
     *
     * 想保留角标（例如要公开传播 AI 内容、需要显式标识）就把这项设成 false。
     */
    removeWatermark: z<boolean, boolean>;
    /**
     * 安全过滤。**默认 false**：实测 safe=true 会被判到付费面返回 402，
     * 故默认关闭以免工具整体不可用；需要严格过滤时再手动打开。
     */
    safe: z<boolean, boolean>;
    /**
     * 可选 pollinations token（auth.pollinations.ai 免费注册即可）。
     * 匿名档限流紧、参数面窄；配了 token 才用得上 enhance/private/safe 与更多模型。
     */
    token: z<string, string>;
    /** 默认是否把取回的图片存为附件（即默认显示真图）。 */
    attach: z<boolean, boolean>;
    /**
     * 后端顺序。默认先 HF Space（FLUX.1-schnell，免密钥、**无水印**），
     * 失败再回退 pollinations 极简档（实测匿名可用、约 15s/条限流，但**图上有
     * pollinations.ai 水印**——该水印由上游服务端烧进像素，`nologo=true` 也去不掉，
     * 详见下面 nologo 字段说明）。
     * 可选值：'pollinations' | 'huggingface' | 'together'。
     */
    providers: z<string[], string[]>;
    /** HF Space 后端（FLUX.1-schnell，免密钥、匿名排队）配置。 */
    huggingface: z<Schemastery.ObjectS<{
        space: z<string, string>;
        /** FLUX.1-schnell 只支持 1–8 步；步数越多越慢。 */
        steps: z<number, number>;
    }>, Schemastery.ObjectT<{
        space: z<string, string>;
        /** FLUX.1-schnell 只支持 1–8 步；步数越多越慢。 */
        steps: z<number, number>;
    }>>;
    /**
     * Together.ai（OpenAI 兼容、Bearer key）后端。**有 key 时这是最稳的一条路**：
     * `black-forest-labs/FLUX.1-schnell-Free` 官方标注免费无限量（按请求限速）。
     * 免费注册 https://api.together.xyz 拿 key 填到 `together.key`，再把 'together'
     * 放进 providers 首位即可。key 为空时该后端自动跳过。
     */
    together: z<Schemastery.ObjectS<{
        key: z<string, string>;
        baseUrl: z<string, string>;
        model: z<string, string>;
        steps: z<number, number>;
    }>, Schemastery.ObjectT<{
        key: z<string, string>;
        baseUrl: z<string, string>;
        model: z<string, string>;
        steps: z<number, number>;
    }>>;
    /**
     * 智谱 BigModel（CogView）后端 —— **国内不用加速器就能用的那条路**：
     * 域名 `open.bigmodel.cn` 直连可达（实测 401 = 通），注册送额度，
     * 其中 `cogview-3-flash` 是**免费模型**。
     *
     * 免费注册 https://open.bigmodel.cn → 拿 API key 填 `zhipu.key`，再把 'zhipu'
     * 放进 providers 首位。key 为空时该后端自动跳过。
     */
    zhipu: z<Schemastery.ObjectS<{
        key: z<string, string>;
        baseUrl: z<string, string>;
        model: z<string, string>;
    }>, Schemastery.ObjectT<{
        key: z<string, string>;
        baseUrl: z<string, string>;
        model: z<string, string>;
    }>>;
    timeoutMs: z<number, number>;
    /**
     * 工具级总预算：默认 3 分钟，够"取图 + 落附件"这类正常调用，又短到
     * 上游挂住时能靠超时策略把回合交还给模型。(单后端取图预算见 timeoutMs)
     */
    toolTimeoutMs: z<number, number>;
}>>;
export declare function apply(ctx: Context, config: Config): void;
