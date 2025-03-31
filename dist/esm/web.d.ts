import { WebPlugin } from '@capacitor/core';
import type { ConfigureOptions, PreloadOptions } from './definitions';
import { NativeAudio } from './definitions';
export declare class NativeAudioWeb extends WebPlugin implements NativeAudio {
    private static readonly FILE_LOCATION;
    private static readonly AUDIO_ASSET_BY_ASSET_ID;
    constructor();
    resume(options: {
        assetId: string;
    }): Promise<void>;
    pause(options: {
        assetId: string;
    }): Promise<void>;
    setCurrentTime(options: {
        assetId: string;
        time: number;
    }): Promise<void>;
    getCurrentTime(options: {
        assetId: string;
    }): Promise<{
        currentTime: number;
    }>;
    getDuration(options: {
        assetId: string;
    }): Promise<{
        duration: number;
    }>;
    configure(options: ConfigureOptions): Promise<void>;
    isPreloaded(options: PreloadOptions): Promise<{
        found: boolean;
    }>;
    preload(options: PreloadOptions): Promise<void>;
    private onEnded;
    play(options: {
        assetId: string;
        time?: number;
    }): Promise<void>;
    loop(options: {
        assetId: string;
    }): Promise<void>;
    stop(options: {
        assetId: string;
    }): Promise<void>;
    unload(options: {
        assetId: string;
    }): Promise<void>;
    setVolume(options: {
        assetId: string;
        volume: number;
    }): Promise<void>;
    setRate(options: {
        assetId: string;
        rate: number;
    }): Promise<void>;
    isPlaying(options: {
        assetId: string;
    }): Promise<{
        isPlaying: boolean;
    }>;
    clearCache(): Promise<void>;
    private getAudioAsset;
    private checkAssetId;
}
declare const NativeAudio: NativeAudioWeb;
export { NativeAudio };
