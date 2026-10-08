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
    safe: boolean;
    /** 可选 pollinations token（空字符串 = 匿名档）。 */
    token: string;
    /** 后端顺序（'huggingface' | 'pollinations'）。 */
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
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** 生图接口前缀，prompt 以 URL 编码追加在其后。 */
    endpoint: z<string, string, "defined">;
    /**
     * 默认尺寸。取 1024×1024 = pollinations 上游自身的默认值——显式写 width/height
     * 在匿名档会被判到付费面（402），所以默认尺寸下干脆不写进 URL，报出的尺寸即上游默认。
     */
    width: z<number, number, "defined">;
    height: z<number, number, "defined">;
    /**
     * 默认模型。实测（2026-10）匿名档唯一稳定可用的是极简 URL + `model=flux`：
     * sana/turbo 会 402（"Insufficient balance"），flux 极简可出图。
     */
    model: z<string, string, "defined">;
    /**
     * 提示词增强。**默认 false**：enhance=true 属付费面，匿名请求会 402，故默认关闭。
     */
    enhance: z<boolean, boolean, "defined">;
    /**
     * private=true 在匿名档会整体落到付费判定（实测 402），**默认 false**；
     * 有 token 的部署可打开。注意：关闭后生成的图会出现在 pollinations 公共 feed 里。
     */
    private: z<boolean, boolean, "defined">;
    /**
     * 传给 pollinations 的 `nologo` 参数。⚠️ 实测（2026-10）它**去不掉水印**：
     * 免费匿名档的 pollinations.ai 水印由上游服务端烧进像素，带不带 nologo 都在。
     * 想要无水印图只能换后端（默认已改为 huggingface / 或配 together.key）。
     */
    nologo: z<boolean, boolean, "defined">;
    /**
     * 安全过滤。**默认 false**：实测 safe=true 会被判到付费面返回 402，
     * 故默认关闭以免工具整体不可用；需要严格过滤时再手动打开。
     */
    safe: z<boolean, boolean, "defined">;
    /**
     * 可选 pollinations token（auth.pollinations.ai 免费注册即可）。
     * 匿名档限流紧、参数面窄；配了 token 才用得上 enhance/private/safe 与更多模型。
     */
    token: z<string, string, "defined">;
    /** 默认是否把取回的图片存为附件（即默认显示真图）。 */
    attach: z<boolean, boolean, "defined">;
    /**
     * 后端顺序。默认先 HF Space（FLUX.1-schnell，免密钥、**无水印**），
     * 失败再回退 pollinations 极简档（实测匿名可用、约 15s/条限流，但**图上有
     * pollinations.ai 水印**——该水印由上游服务端烧进像素，`nologo=true` 也去不掉，
     * 详见下面 nologo 字段说明）。
     * 可选值：'pollinations' | 'huggingface' | 'together'。
     */
    providers: z<string[], string[], "defined">;
    /** HF Space 后端（FLUX.1-schnell，免密钥、匿名排队）配置。 */
    huggingface: z<Schemastery.ObjectS<NoInfer<{
        space: z<string, string, "defined">;
        /** FLUX.1-schnell 只支持 1–8 步；步数越多越慢。 */
        steps: z<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        space: z<string, string, "defined">;
        /** FLUX.1-schnell 只支持 1–8 步；步数越多越慢。 */
        steps: z<number, number, "defined">;
    }>>, "plain">;
    /**
     * Together.ai（OpenAI 兼容、Bearer key）后端。**有 key 时这是最稳的一条路**：
     * `black-forest-labs/FLUX.1-schnell-Free` 官方标注免费无限量（按请求限速）。
     * 免费注册 https://api.together.xyz 拿 key 填到 `together.key`，再把 'together'
     * 放进 providers 首位即可。key 为空时该后端自动跳过。
     */
    together: z<Schemastery.ObjectS<NoInfer<{
        key: z<string, string, "defined">;
        baseUrl: z<string, string, "defined">;
        model: z<string, string, "defined">;
        steps: z<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        key: z<string, string, "defined">;
        baseUrl: z<string, string, "defined">;
        model: z<string, string, "defined">;
        steps: z<number, number, "defined">;
    }>>, "plain">;
    timeoutMs: z<number, number, "defined">;
    /**
     * 工具级总预算：默认 3 分钟，够"取图 + 落附件"这类正常调用，又短到
     * 上游挂住时能靠超时策略把回合交还给模型。(单后端取图预算见 timeoutMs)
     */
    toolTimeoutMs: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** 生图接口前缀，prompt 以 URL 编码追加在其后。 */
    endpoint: z<string, string, "defined">;
    /**
     * 默认尺寸。取 1024×1024 = pollinations 上游自身的默认值——显式写 width/height
     * 在匿名档会被判到付费面（402），所以默认尺寸下干脆不写进 URL，报出的尺寸即上游默认。
     */
    width: z<number, number, "defined">;
    height: z<number, number, "defined">;
    /**
     * 默认模型。实测（2026-10）匿名档唯一稳定可用的是极简 URL + `model=flux`：
     * sana/turbo 会 402（"Insufficient balance"），flux 极简可出图。
     */
    model: z<string, string, "defined">;
    /**
     * 提示词增强。**默认 false**：enhance=true 属付费面，匿名请求会 402，故默认关闭。
     */
    enhance: z<boolean, boolean, "defined">;
    /**
     * private=true 在匿名档会整体落到付费判定（实测 402），**默认 false**；
     * 有 token 的部署可打开。注意：关闭后生成的图会出现在 pollinations 公共 feed 里。
     */
    private: z<boolean, boolean, "defined">;
    /**
     * 传给 pollinations 的 `nologo` 参数。⚠️ 实测（2026-10）它**去不掉水印**：
     * 免费匿名档的 pollinations.ai 水印由上游服务端烧进像素，带不带 nologo 都在。
     * 想要无水印图只能换后端（默认已改为 huggingface / 或配 together.key）。
     */
    nologo: z<boolean, boolean, "defined">;
    /**
     * 安全过滤。**默认 false**：实测 safe=true 会被判到付费面返回 402，
     * 故默认关闭以免工具整体不可用；需要严格过滤时再手动打开。
     */
    safe: z<boolean, boolean, "defined">;
    /**
     * 可选 pollinations token（auth.pollinations.ai 免费注册即可）。
     * 匿名档限流紧、参数面窄；配了 token 才用得上 enhance/private/safe 与更多模型。
     */
    token: z<string, string, "defined">;
    /** 默认是否把取回的图片存为附件（即默认显示真图）。 */
    attach: z<boolean, boolean, "defined">;
    /**
     * 后端顺序。默认先 HF Space（FLUX.1-schnell，免密钥、**无水印**），
     * 失败再回退 pollinations 极简档（实测匿名可用、约 15s/条限流，但**图上有
     * pollinations.ai 水印**——该水印由上游服务端烧进像素，`nologo=true` 也去不掉，
     * 详见下面 nologo 字段说明）。
     * 可选值：'pollinations' | 'huggingface' | 'together'。
     */
    providers: z<string[], string[], "defined">;
    /** HF Space 后端（FLUX.1-schnell，免密钥、匿名排队）配置。 */
    huggingface: z<Schemastery.ObjectS<NoInfer<{
        space: z<string, string, "defined">;
        /** FLUX.1-schnell 只支持 1–8 步；步数越多越慢。 */
        steps: z<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        space: z<string, string, "defined">;
        /** FLUX.1-schnell 只支持 1–8 步；步数越多越慢。 */
        steps: z<number, number, "defined">;
    }>>, "plain">;
    /**
     * Together.ai（OpenAI 兼容、Bearer key）后端。**有 key 时这是最稳的一条路**：
     * `black-forest-labs/FLUX.1-schnell-Free` 官方标注免费无限量（按请求限速）。
     * 免费注册 https://api.together.xyz 拿 key 填到 `together.key`，再把 'together'
     * 放进 providers 首位即可。key 为空时该后端自动跳过。
     */
    together: z<Schemastery.ObjectS<NoInfer<{
        key: z<string, string, "defined">;
        baseUrl: z<string, string, "defined">;
        model: z<string, string, "defined">;
        steps: z<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        key: z<string, string, "defined">;
        baseUrl: z<string, string, "defined">;
        model: z<string, string, "defined">;
        steps: z<number, number, "defined">;
    }>>, "plain">;
    timeoutMs: z<number, number, "defined">;
    /**
     * 工具级总预算：默认 3 分钟，够"取图 + 落附件"这类正常调用，又短到
     * 上游挂住时能靠超时策略把回合交还给模型。(单后端取图预算见 timeoutMs)
     */
    toolTimeoutMs: z<number, number, "defined">;
}>>, "plain">;
export declare function apply(ctx: Context, config: Config): void;
