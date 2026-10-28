import type { Context } from '@deepseek-ai/cordis';
import { Config, type TranscriptConfig } from './config.js';
export { Config };
export type { TranscriptConfig };
/** 与 cordis.patch.yml 的 id 一致。 */
export declare const name = "transcript";
export declare const inject: readonly ["tools"];
export declare function apply(ctx: Context, config?: TranscriptConfig): void;
