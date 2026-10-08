/** sharp 的最小形状：只声明这里用到的几个方法，省掉 @types/sharp 依赖。 */
interface SharpInstance {
    metadata(): Promise<{
        width?: number;
        height?: number;
    }>;
    extract(region: {
        left: number;
        top: number;
        width: number;
        height: number;
    }): SharpInstance;
    removeAlpha(): SharpInstance;
    flop(): SharpInstance;
    greyscale(): SharpInstance;
    raw(): SharpInstance;
    png(): SharpInstance;
    jpeg(options?: {
        quality?: number;
    }): SharpInstance;
    joinChannel(channel: Buffer, options: unknown): SharpInstance;
    composite(inputs: Array<{
        input: Buffer;
        left?: number;
        top?: number;
    }>): SharpInstance;
    toBuffer(options: {
        resolveWithObject: true;
    }): Promise<{
        data: Buffer;
        info: {
            width: number;
            height: number;
            channels: number;
        };
    }>;
    toBuffer(): Promise<Buffer>;
}
type SharpFactory = (input: unknown, options?: unknown) => SharpInstance;
/**
 * 找 sharp：本包 node_modules（build-local 会挂 junction）→ dsh 安装/源码目录。
 * 找不到就抛 —— 调用方按"去不掉水印但图照出"处理，不能因为一个可选能力让生图整体失败。
 */
export declare function loadSharp(): SharpFactory;
/** 水印框（按图片尺寸等比缩放）。实测 1024×1024 → 左上 (819, 922)，205×102。 */
export declare function watermarkBox(width: number, height: number): {
    left: number;
    top: number;
    width: number;
    height: number;
};
export interface DewatermarkOptions {
    /**
     * `auto`（默认）：按角落的对比度自己挑 —— 平滑背景用 `inpaint`（扩散修补），
     * 高对比线稿用 `mirror`（镜像，保留线条质感）。
     * 也可以强制 `inpaint` / `mirror` / `patch` / `crop`（crop 直接裁掉最下面 10%）。
     */
    mode?: 'auto' | 'inpaint' | 'mirror' | 'patch' | 'crop';
    quality?: number;
    box?: {
        left: number;
        top: number;
        width: number;
        height: number;
    };
}
/**
 * 去掉一张图的水印，返回 JPEG 字节。图不是 JPEG（或没有水印）也无所谓 —— 调用方按需使用。
 * 抛错时调用方应保留原图（去水印是可选增强，不该让生图失败）。
 */
export declare function dewatermark(input: Uint8Array, options?: DewatermarkOptions): Promise<Buffer>;
export {};
