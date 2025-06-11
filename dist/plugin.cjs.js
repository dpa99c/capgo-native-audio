'use strict';

var core = require('@capacitor/core');

const NativeAudio$1 = core.registerPlugin('NativeAudio', {
    web: () => Promise.resolve().then(function () { return web; }).then((m) => new m.NativeAudioWeb()),
});

class AudioAsset {
    constructor(audio) {
        this.audio = audio;
    }
}

class NativeAudioWeb extends core.WebPlugin {
    constructor() {
        super(...arguments);
        this.debugMode = false;
        this.currentTimeIntervals = new Map();
        this.zeroVolume = 0.0001; // Avoids the gain node being set to 0 for exponential ramping
    }
    async resume(options) {
        const audio = this.getAudioAsset(options.assetId).audio;
        const data = this.getAudioAssetData(options.assetId);
        const targetVolume = data.volumeBeforePause || data.volume || 1;
        if (options === null || options === void 0 ? void 0 : options.fadeIn) {
            const fadeDuration = options.fadeInDuration || NativeAudioWeb.DEFAULT_FADE_DURATION_SEC;
            this.doFadeIn(audio, fadeDuration, targetVolume);
        }
        else if (audio.volume <= this.zeroVolume) {
            audio.volume = targetVolume;
        }
        this.doResume(options.assetId);
    }
    async doResume(assetId) {
        const audio = this.getAudioAsset(assetId).audio;
        this.startCurrentTimeUpdates(assetId);
        if (audio.paused) {
            return audio.play();
        }
    }
    async pause(options) {
        const audio = this.getAudioAsset(options.assetId).audio;
        this.cancelGainNodeRamp(audio); // cancel any existing scheduled volume changes
        const data = this.getAudioAssetData(options.assetId);
        data.volumeBeforePause = data.volume || audio.volume;
        this.setAudioAssetData(options.assetId, data);
        if (options === null || options === void 0 ? void 0 : options.fadeOut) {
            this.cancelGainNodeRamp(audio);
            const fadeOutDuration = options.fadeOutDuration || NativeAudioWeb.DEFAULT_FADE_DURATION_SEC;
            this.doFadeOut(audio, fadeOutDuration);
            data.fadeOutToStopTimer = setTimeout(() => {
                this.doPause(options.assetId);
            }, fadeOutDuration * 1000);
            this.setAudioAssetData(options.assetId, data);
        }
        else {
            this.doPause(options.assetId);
        }
    }
    async doPause(assetId) {
        const audio = this.getAudioAsset(assetId).audio;
        this.clearFadeOutToStopTimer(assetId);
        this.stopCurrentTimeUpdates(assetId);
        return audio.pause();
    }
    async setCurrentTime(options) {
        const audio = this.getAudioAsset(options.assetId).audio;
        audio.currentTime = options.time;
        return;
    }
    async getCurrentTime(options) {
        const audio = this.getAudioAsset(options.assetId).audio;
        return { currentTime: audio.currentTime };
    }
    async getDuration(options) {
        const audio = this.getAudioAsset(options.assetId).audio;
        if (Number.isNaN(audio.duration)) {
            throw 'no duration available';
        }
        if (!Number.isFinite(audio.duration)) {
            throw 'duration not available => media resource is streaming';
        }
        return { duration: audio.duration };
    }
    async setDebugMode(options) {
        this.debugMode = options.enabled;
        if (this.debugMode) {
            this.logInfo('Debug mode enabled');
        }
    }
    async configure(options) {
        throw `configure is not supported for web: ${JSON.stringify(options)}`;
    }
    async isPreloaded(options) {
        try {
            return { found: !!this.getAudioAsset(options.assetId) };
        }
        catch (e) {
            return { found: false };
        }
    }
    async preload(options) {
        var _a;
        this.logInfo(`Preloading audio asset with options: ${JSON.stringify(options)}`);
        if (NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.has(options.assetId)) {
            throw 'AssetId already exists. Unload first if like to change!';
        }
        if (!((_a = options.assetPath) === null || _a === void 0 ? void 0 : _a.length)) {
            throw 'no assetPath provided';
        }
        NativeAudioWeb.AUDIO_PRELOAD_OPTIONS_MAP.set(options.assetId, options);
        await new Promise((resolve, reject) => {
            if (!options.isUrl && !new RegExp('^/?' + NativeAudioWeb.FILE_LOCATION).test(options.assetPath)) {
                const slashPrefix = options.assetPath.startsWith('/') ? '' : '/';
                options.assetPath = `${NativeAudioWeb.FILE_LOCATION}${slashPrefix}${options.assetPath}`;
            }
            const audio = document.createElement('audio');
            audio.crossOrigin = 'anonymous';
            audio.src = options.assetPath;
            audio.autoplay = false;
            audio.loop = false;
            audio.preload = 'metadata';
            audio.addEventListener('loadedmetadata', () => {
                resolve();
            });
            audio.addEventListener('error', (errEvt) => {
                this.logError(`Error loading audio file: ${options.assetPath}, error: ${errEvt}`);
                reject('Error loading audio file');
            });
            const data = this.getAudioAssetData(options.assetId);
            if (options.volume) {
                audio.volume = options.volume;
                data.volume = options.volume;
            }
            else {
                data.volume = audio.volume;
            }
            NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.set(options.assetId, new AudioAsset(audio));
            this.setAudioAssetData(options.assetId, data);
        });
    }
    onEnded(assetId) {
        this.logDebug(`Playback ended for assetId: ${assetId}`);
        this.notifyListeners('complete', { assetId });
    }
    async play(options) {
        this.logInfo(`Playing audio asset with options: ${JSON.stringify(options)}`);
        this.clearFadeOutToStopTimer(options.assetId);
        const { delay = 0 } = options;
        if (delay > 0) {
            const data = this.getAudioAssetData(options.assetId);
            data.startTimer = setTimeout(() => {
                this.doPlay(options);
                data.startTimer = 0;
                this.setAudioAssetData(options.assetId, data);
            }, delay * 1000);
            this.setAudioAssetData(options.assetId, data);
        }
        else {
            await this.doPlay(options);
        }
    }
    async doPlay(options) {
        const { assetId, time = 0 } = options;
        if (!NativeAudioWeb.AUDIO_PRELOAD_OPTIONS_MAP.has(assetId)) {
            throw `no asset for assetId "${assetId}" available. Call preload first!`;
        }
        const preloadOptions = NativeAudioWeb.AUDIO_PRELOAD_OPTIONS_MAP.get(assetId);
        // unload asset to create a new HTMLAudioElement because reusing the same element causes issues with the audio context
        await this.unload(options);
        // preload the asset again to create a new HTMLAudioElement
        await this.preload(preloadOptions);
        const audio = this.getAudioAsset(assetId).audio;
        audio.loop = false;
        audio.currentTime = time;
        audio.addEventListener('ended', () => this.onEnded(assetId), {
            once: true,
        });
        const data = this.getAudioAssetData(assetId);
        if (options.volume) {
            audio.volume = options.volume;
            data.volume = options.volume;
            this.setGainNodeVolume(audio, options.volume);
        }
        else if (!data.volume) {
            data.volume = audio.volume;
        }
        audio.play();
        this.startCurrentTimeUpdates(assetId);
        if (options.fadeIn) {
            this.logDebug(`Fading in audio asset with assetId: ${assetId}`);
            const fadeDuration = options.fadeInDuration || NativeAudioWeb.DEFAULT_FADE_DURATION_SEC;
            this.doFadeIn(audio, fadeDuration);
        }
        if (options.fadeOut && !Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
            this.logDebug(`Fading out audio asset with assetId: ${assetId}`);
            const fadeOutDuration = options.fadeOutDuration || NativeAudioWeb.DEFAULT_FADE_DURATION_SEC;
            const fadeOutStartTime = options.fadeOutStartTime || audio.duration - fadeOutDuration;
            data.fadeOut = true;
            data.fadeOutStartTime = fadeOutStartTime;
            data.fadeOutDuration = fadeOutDuration;
        }
        this.setAudioAssetData(assetId, data);
    }
    doFadeIn(audio, fadeDuration, targetVolume) {
        const data = this.getAudioAssetData(audio.id);
        this.setGainNodeVolume(audio, 0);
        const fadeToVolume = targetVolume !== null && targetVolume !== void 0 ? targetVolume : 1;
        this.linearRampGainNodeVolume(audio, fadeToVolume, fadeDuration);
        data.fadeInTimer = setTimeout(() => {
            data.fadeInTimer = 0;
            this.setAudioAssetData(audio.id, data);
        }, fadeDuration * 1000);
        this.setAudioAssetData(audio.id, data);
    }
    doFadeOut(audio, fadeDuration) {
        this.linearRampGainNodeVolume(audio, 0, fadeDuration);
    }
    async loop(options) {
        this.logInfo(`Looping audio asset with options: ${JSON.stringify(options)}`);
        const audio = this.getAudioAsset(options.assetId).audio;
        this.reset(audio);
        audio.loop = true;
        this.startCurrentTimeUpdates(options.assetId);
        return audio.play();
    }
    async stop(options) {
        this.logInfo(`Stopping audio asset with options: ${JSON.stringify(options)}`);
        const audio = this.getAudioAsset(options.assetId).audio;
        const data = this.getAudioAssetData(options.assetId);
        this.clearFadeOutToStopTimer(options.assetId);
        this.cancelGainNodeRamp(audio); // cancel any existing scheduled volume changes
        if (!audio.paused && options.fadeOut) {
            const fadeDuration = options.fadeOutDuration || NativeAudioWeb.DEFAULT_FADE_DURATION_SEC;
            this.doFadeOut(audio, fadeDuration);
            data.fadeOutToStopTimer = setTimeout(() => {
                this.doStop(audio, options);
            }, fadeDuration * 1000);
            this.setAudioAssetData(options.assetId, data);
        }
        else {
            this.doStop(audio, options);
        }
    }
    doStop(audio, options) {
        audio.pause();
        this.onEnded(options.assetId);
        this.reset(audio);
    }
    reset(audio) {
        var _a;
        audio.currentTime = 0;
        for (const [assetId, asset] of NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.entries()) {
            if (asset.audio === audio) {
                this.stopCurrentTimeUpdates(assetId);
                this.clearFadeOutToStopTimer(assetId);
                this.clearStartTimer(assetId);
                this.cancelGainNodeRamp(audio);
                const data = this.getAudioAssetData(assetId);
                const initialVolume = (_a = data.volume) !== null && _a !== void 0 ? _a : 1;
                this.setGainNodeVolume(audio, initialVolume);
                this.setAudioAssetData(assetId, data);
                break;
            }
        }
    }
    clearFadeOutToStopTimer(assetId) {
        const data = this.getAudioAssetData(assetId);
        if (data === null || data === void 0 ? void 0 : data.fadeOutToStopTimer) {
            clearTimeout(data.fadeOutToStopTimer);
            data.fadeOutToStopTimer = 0;
            this.setAudioAssetData(assetId, data);
        }
    }
    clearStartTimer(assetId) {
        const data = this.getAudioAssetData(assetId);
        if (data.startTimer) {
            clearTimeout(data.startTimer);
            data.startTimer = 0;
            this.setAudioAssetData(assetId, data);
        }
    }
    async unload(options) {
        this.logInfo(`Unloading audio asset with options: ${JSON.stringify(options)}`);
        const audio = this.getAudioAsset(options.assetId).audio;
        this.reset(audio);
        NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.delete(options.assetId);
        NativeAudioWeb.AUDIO_PRELOAD_OPTIONS_MAP.delete(options.assetId);
        NativeAudioWeb.AUDIO_DATA_MAP.delete(options.assetId);
        this.cleanupAudioContext(audio);
    }
    cleanupAudioContext(audio) {
        const gainNode = NativeAudioWeb.GAIN_NODE_MAP.get(audio);
        if (gainNode) {
            gainNode.disconnect();
            NativeAudioWeb.GAIN_NODE_MAP.delete(audio);
        }
        const audioContext = NativeAudioWeb.AUDIO_CONTEXT_MAP.get(audio);
        if (audioContext) {
            audioContext.close();
            NativeAudioWeb.AUDIO_CONTEXT_MAP.delete(audio);
        }
        const sourceNode = NativeAudioWeb.MEDIA_ELEMENT_SOURCE_MAP.get(audio);
        if (sourceNode) {
            sourceNode.disconnect();
            NativeAudioWeb.MEDIA_ELEMENT_SOURCE_MAP.delete(audio);
        }
    }
    async setVolume(options) {
        this.logInfo(`Setting volume for audio asset with options: ${JSON.stringify(options)}`);
        if (typeof (options === null || options === void 0 ? void 0 : options.volume) !== 'number') {
            throw 'no volume provided';
        }
        const { volume, duration = 0 } = options;
        const data = this.getAudioAssetData(options.assetId);
        data.volume = volume;
        this.setAudioAssetData(options.assetId, data);
        const audio = this.getAudioAsset(options.assetId).audio;
        this.cancelGainNodeRamp(audio); // cancel any existing scheduled volume changes
        if (duration > 0) {
            this.exponentialRampGainNodeVolume(audio, volume, duration);
        }
        else {
            audio.volume = volume;
        }
    }
    async setRate(options) {
        this.logInfo(`Setting playback rate for audio asset with options: ${JSON.stringify(options)}`);
        if (typeof (options === null || options === void 0 ? void 0 : options.rate) !== 'number') {
            throw 'no rate provided';
        }
        const audio = this.getAudioAsset(options.assetId).audio;
        audio.playbackRate = options.rate;
    }
    async isPlaying(options) {
        const audio = this.getAudioAsset(options.assetId).audio;
        return { isPlaying: !audio.paused };
    }
    async clearCache() {
        this.logWarning('clearCache is not supported for web. No cache to clear.');
        return;
    }
    getAudioAsset(assetId) {
        this.checkAssetId(assetId);
        if (!NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.has(assetId)) {
            throw `no asset for assetId "${assetId}" available. Call preload first!`;
        }
        return NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.get(assetId);
    }
    checkAssetId(assetId) {
        if (typeof assetId !== 'string') {
            throw 'assetId must be a string';
        }
        if (!(assetId === null || assetId === void 0 ? void 0 : assetId.length)) {
            throw 'no assetId provided';
        }
    }
    getOrCreateAudioContext(audio) {
        if (NativeAudioWeb.AUDIO_CONTEXT_MAP.has(audio)) {
            return NativeAudioWeb.AUDIO_CONTEXT_MAP.get(audio);
        }
        const audioContext = new AudioContext();
        NativeAudioWeb.AUDIO_CONTEXT_MAP.set(audio, audioContext);
        return audioContext;
    }
    getOrCreateMediaElementSource(audioContext, audio) {
        if (NativeAudioWeb.MEDIA_ELEMENT_SOURCE_MAP.has(audio)) {
            return NativeAudioWeb.MEDIA_ELEMENT_SOURCE_MAP.get(audio);
        }
        const sourceNode = audioContext.createMediaElementSource(audio);
        NativeAudioWeb.MEDIA_ELEMENT_SOURCE_MAP.set(audio, sourceNode);
        return sourceNode;
    }
    getOrCreateGainNode(audio, track) {
        const audioContext = this.getOrCreateAudioContext(audio);
        if (NativeAudioWeb.GAIN_NODE_MAP.has(audio)) {
            return NativeAudioWeb.GAIN_NODE_MAP.get(audio);
        }
        const gainNode = audioContext.createGain();
        track.connect(gainNode).connect(audioContext.destination);
        NativeAudioWeb.GAIN_NODE_MAP.set(audio, gainNode);
        return gainNode;
    }
    setGainNodeVolume(audio, volume, time) {
        const audioContext = this.getOrCreateAudioContext(audio);
        const track = this.getOrCreateMediaElementSource(audioContext, audio);
        const gainNode = this.getOrCreateGainNode(audio, track);
        if (time) {
            gainNode.gain.setValueAtTime(volume, time);
        }
        else {
            gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        }
    }
    exponentialRampGainNodeVolume(audio, volume, duration) {
        const audioContext = this.getOrCreateAudioContext(audio);
        const track = this.getOrCreateMediaElementSource(audioContext, audio);
        const gainNode = this.getOrCreateGainNode(audio, track);
        let adjustedVolume = volume;
        if (volume < this.zeroVolume) {
            adjustedVolume = this.zeroVolume;
        }
        // Use exponential ramping for human hearing perception
        gainNode.gain.exponentialRampToValueAtTime(adjustedVolume, audioContext.currentTime + duration);
    }
    linearRampGainNodeVolume(audio, volume, duration) {
        const audioContext = this.getOrCreateAudioContext(audio);
        const track = this.getOrCreateMediaElementSource(audioContext, audio);
        const gainNode = this.getOrCreateGainNode(audio, track);
        gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + duration);
    }
    cancelGainNodeRamp(audio) {
        const gainNode = NativeAudioWeb.GAIN_NODE_MAP.get(audio);
        if (gainNode) {
            gainNode.gain.cancelScheduledValues(0);
        }
    }
    startCurrentTimeUpdates(assetId) {
        this.stopCurrentTimeUpdates(assetId);
        const audio = this.getAudioAsset(assetId).audio;
        const intervalId = window.setInterval(() => {
            if (!audio.paused) {
                const currentTime = Math.round(audio.currentTime * 10) / 10; // Round to nearest 100ms
                this.notifyListeners('currentTime', { assetId, currentTime });
                this.logDebug(`Current time update for assetId: ${assetId}, currentTime: ${currentTime}`);
                const data = this.getAudioAssetData(assetId);
                if (data.fadeOut && audio.currentTime >= data.fadeOutStartTime) {
                    this.cancelGainNodeRamp(audio);
                    this.setAudioAssetData(assetId, data);
                    this.doFadeOut(audio, data.fadeOutDuration);
                }
            }
            else {
                this.stopCurrentTimeUpdates(assetId);
            }
        }, NativeAudioWeb.CURRENT_TIME_UPDATE_INTERVAL);
        this.currentTimeIntervals.set(assetId, intervalId);
    }
    stopCurrentTimeUpdates(assetId) {
        if (assetId) {
            const intervalId = this.currentTimeIntervals.get(assetId);
            if (intervalId) {
                clearInterval(intervalId);
                this.currentTimeIntervals.delete(assetId);
            }
        }
        else {
            for (const intervalId of this.currentTimeIntervals.values()) {
                clearInterval(intervalId);
            }
            this.currentTimeIntervals.clear();
        }
    }
    getAudioAssetData(assetId) {
        return NativeAudioWeb.AUDIO_DATA_MAP.get(assetId) || {};
    }
    setAudioAssetData(assetId, data) {
        const currentData = NativeAudioWeb.AUDIO_DATA_MAP.get(assetId) || {};
        const newData = Object.assign(Object.assign({}, currentData), data);
        NativeAudioWeb.AUDIO_DATA_MAP.set(assetId, newData);
    }
    logError(message) {
        if (!this.debugMode)
            return;
        console.error(`${NativeAudioWeb.LOG_TAG} Error: ${message}`);
    }
    logWarning(message) {
        if (!this.debugMode)
            return;
        console.warn(`${NativeAudioWeb.LOG_TAG} Warning: ${message}`);
    }
    logInfo(message) {
        if (!this.debugMode)
            return;
        console.info(`${NativeAudioWeb.LOG_TAG} Info: ${message}`);
    }
    logDebug(message) {
        if (!this.debugMode)
            return;
        console.debug(`${NativeAudioWeb.LOG_TAG} Debug: ${message}`);
    }
}
NativeAudioWeb.LOG_TAG = '[NativeAudioWeb]';
NativeAudioWeb.FILE_LOCATION = '';
NativeAudioWeb.DEFAULT_FADE_DURATION_SEC = 1;
NativeAudioWeb.CURRENT_TIME_UPDATE_INTERVAL = 100;
NativeAudioWeb.AUDIO_PRELOAD_OPTIONS_MAP = new Map();
NativeAudioWeb.AUDIO_DATA_MAP = new Map();
NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID = new Map();
NativeAudioWeb.AUDIO_CONTEXT_MAP = new Map();
NativeAudioWeb.MEDIA_ELEMENT_SOURCE_MAP = new Map();
NativeAudioWeb.GAIN_NODE_MAP = new Map();
const NativeAudio = new NativeAudioWeb();

var web = /*#__PURE__*/Object.freeze({
    __proto__: null,
    NativeAudio: NativeAudio,
    NativeAudioWeb: NativeAudioWeb
});

exports.NativeAudio = NativeAudio$1;
//# sourceMappingURL=plugin.cjs.js.map
