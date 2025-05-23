import { WebPlugin } from '@capacitor/core';
import type { ConfigureOptions, PreloadOptions, AssetPlayOptions, Assets, AssetSetTime, AssetVolume, AssetRate, AssetStopOptions } from './definitions';
import { NativeAudio } from './definitions';
export declare class NativeAudioWeb extends WebPlugin implements NativeAudio {
    private static readonly FILE_LOCATION;
    private static readonly DEFAULT_FADE_DURATION_SEC;
    private static readonly CURRENT_TIME_UPDATE_INTERVAL;
    private static readonly AUDIO_PRELOAD_OPTIONS_MAP;
    private static readonly AUDIO_ASSET_BY_ASSET_ID;
    private static readonly AUDIO_CONTEXT_MAP;
    private static readonly MEDIA_ELEMENT_SOURCE_MAP;
    private static readonly GAIN_NODE_MAP;
    private static readonly INITIAL_VOLUME_MAP;
    private currentTimeIntervals;
    private fadeOutTimer;
    private startTimer;
    private zeroVolume;
    resume(options: Assets): Promise<void>;
    pause(options: Assets): Promise<void>;
    setCurrentTime(options: AssetSetTime): Promise<void>;
    getCurrentTime(options: Assets): Promise<{
        currentTime: number;
    }>;
    getDuration(options: Assets): Promise<{
        duration: number;
    }>;
    configure(options: ConfigureOptions): Promise<void>;
    isPreloaded(options: PreloadOptions): Promise<{
        found: boolean;
    }>;
    preload(options: PreloadOptions): Promise<void>;
    private onEnded;
    play(options: AssetPlayOptions): Promise<void>;
    private doPlay;
    loop(options: Assets): Promise<void>;
    stop(options: AssetStopOptions): Promise<void>;
    private doStop;
    private reset;
    private clearFadeOutTimer;
    private clearStartTimer;
    unload(options: Assets): Promise<void>;
    private cleanupAudioContext;
    setVolume(options: AssetVolume): Promise<void>;
    setRate(options: AssetRate): Promise<void>;
    isPlaying(options: Assets): Promise<{
        isPlaying: boolean;
    }>;
    clearCache(): Promise<void>;
    private getAudioAsset;
    private checkAssetId;
    private getOrCreateAudioContext;
    private getOrCreateMediaElementSource;
    private getOrCreateGainNode;
    private setGainNodeVolume;
    private exponentialRampGainNodeVolume;
    private linearRampGainNodeVolume;
    private cancelGainNodeRamp;
    private startCurrentTimeUpdates;
    private stopCurrentTimeUpdates;
}
declare const NativeAudio: NativeAudioWeb;
export { NativeAudio };
