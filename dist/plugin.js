var capacitorCapacitorNativeAudio = (function (exports, core) {
    'use strict';

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
            this.currentTimeIntervals = new Map();
            this.fadeOutTimer = 0;
            this.startTimer = 0;
            this.zeroVolume = 0.0001; // Avoids the gain node being set to 0 for exponential ramping
        }
        async resume(options) {
            const audio = this.getAudioAsset(options.assetId).audio;
            this.startCurrentTimeUpdates(options.assetId);
            if (audio.paused) {
                return audio.play();
            }
        }
        async pause(options) {
            const audio = this.getAudioAsset(options.assetId).audio;
            this.cancelGainNodeRamp(audio); // cancel any existing scheduled volume changes
            this.clearFadeOutTimer();
            this.stopCurrentTimeUpdates(options.assetId);
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
                const audio = document.createElement("audio");
                audio.crossOrigin = "anonymous";
                audio.src = options.assetPath;
                audio.autoplay = false;
                audio.loop = false;
                audio.preload = 'metadata';
                audio.addEventListener('loadedmetadata', () => {
                    resolve();
                });
                audio.addEventListener('error', () => reject('Error loading audio file'));
                if (options.volume) {
                    audio.volume = options.volume;
                    NativeAudioWeb.INITIAL_VOLUME_MAP.set(audio, options.volume);
                }
                else {
                    NativeAudioWeb.INITIAL_VOLUME_MAP.set(audio, audio.volume);
                }
                NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.set(options.assetId, new AudioAsset(audio));
            });
        }
        onEnded(assetId) {
            this.notifyListeners('complete', { assetId });
        }
        async play(options) {
            this.clearFadeOutTimer();
            const { delay = 0 } = options;
            if (delay > 0) {
                this.startTimer = setTimeout(() => {
                    this.doPlay(options);
                    this.startTimer = 0;
                }, delay * 1000);
            }
            else {
                await this.doPlay(options);
            }
        }
        async doPlay(options) {
            var _a;
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
            if (options.volume) {
                audio.volume = options.volume;
                NativeAudioWeb.INITIAL_VOLUME_MAP.set(audio, options.volume);
                this.setGainNodeVolume(audio, options.volume);
            }
            else if (!NativeAudioWeb.INITIAL_VOLUME_MAP.has(audio)) {
                NativeAudioWeb.INITIAL_VOLUME_MAP.set(audio, audio.volume);
            }
            audio.play();
            this.startCurrentTimeUpdates(assetId);
            if (options.fadeIn) {
                const fadeDuration = options.fadeInDuration || NativeAudioWeb.DEFAULT_FADE_DURATION_SEC;
                this.setGainNodeVolume(audio, 0);
                const initialVolume = (_a = NativeAudioWeb.INITIAL_VOLUME_MAP.get(audio)) !== null && _a !== void 0 ? _a : 1;
                this.linearRampGainNodeVolume(audio, initialVolume, fadeDuration);
            }
            if (options.fadeOut && !Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
                const fadeDuration = options.fadeOutDuration || NativeAudioWeb.DEFAULT_FADE_DURATION_SEC;
                const fadeOutStartTime = options.fadeOutStartTime || audio.duration - fadeDuration;
                this.fadeOutTimer = setTimeout(() => {
                    this.setGainNodeVolume(audio, audio.volume);
                    this.linearRampGainNodeVolume(audio, 0, fadeDuration);
                    this.fadeOutTimer = 0;
                }, fadeOutStartTime * 1000);
            }
        }
        async loop(options) {
            const audio = this.getAudioAsset(options.assetId).audio;
            this.reset(audio);
            audio.loop = true;
            this.startCurrentTimeUpdates(options.assetId);
            return audio.play();
        }
        async stop(options) {
            const audio = this.getAudioAsset(options.assetId).audio;
            this.clearFadeOutTimer();
            this.cancelGainNodeRamp(audio); // cancel any existing scheduled volume changes
            if (!audio.paused && options.fadeOut) {
                const fadeDuration = options.fadeOutDuration || NativeAudioWeb.DEFAULT_FADE_DURATION_SEC;
                this.linearRampGainNodeVolume(audio, 0, fadeDuration);
                this.fadeOutTimer = setTimeout(() => {
                    this.doStop(audio, options);
                }, fadeDuration * 1000);
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
                    break;
                }
            }
            this.clearFadeOutTimer();
            this.clearStartTimer();
            this.cancelGainNodeRamp(audio);
            const initialVolume = (_a = NativeAudioWeb.INITIAL_VOLUME_MAP.get(audio)) !== null && _a !== void 0 ? _a : 1;
            this.setGainNodeVolume(audio, initialVolume);
        }
        clearFadeOutTimer() {
            if (this.fadeOutTimer) {
                clearTimeout(this.fadeOutTimer);
                this.fadeOutTimer = 0;
            }
        }
        clearStartTimer() {
            if (this.startTimer) {
                clearTimeout(this.startTimer);
                this.startTimer = 0;
            }
        }
        async unload(options) {
            const audio = this.getAudioAsset(options.assetId).audio;
            this.reset(audio);
            NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID.delete(options.assetId);
            NativeAudioWeb.AUDIO_PRELOAD_OPTIONS_MAP.delete(options.assetId);
            this.cleanupAudioContext(audio);
            NativeAudioWeb.INITIAL_VOLUME_MAP.delete(audio);
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
            if (typeof (options === null || options === void 0 ? void 0 : options.volume) !== 'number') {
                throw 'no volume provided';
            }
            const { volume, duration = 0 } = options;
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
            // Web audio doesn't have a persistent cache to clear
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
    }
    NativeAudioWeb.FILE_LOCATION = '';
    NativeAudioWeb.DEFAULT_FADE_DURATION_SEC = 1;
    NativeAudioWeb.CURRENT_TIME_UPDATE_INTERVAL = 100;
    NativeAudioWeb.AUDIO_PRELOAD_OPTIONS_MAP = new Map();
    NativeAudioWeb.AUDIO_ASSET_BY_ASSET_ID = new Map();
    NativeAudioWeb.AUDIO_CONTEXT_MAP = new Map();
    NativeAudioWeb.MEDIA_ELEMENT_SOURCE_MAP = new Map();
    NativeAudioWeb.GAIN_NODE_MAP = new Map();
    NativeAudioWeb.INITIAL_VOLUME_MAP = new Map();
    const NativeAudio = new NativeAudioWeb();

    var web = /*#__PURE__*/Object.freeze({
        __proto__: null,
        NativeAudio: NativeAudio,
        NativeAudioWeb: NativeAudioWeb
    });

    exports.NativeAudio = NativeAudio$1;

    return exports;

})({}, capacitorExports);
//# sourceMappingURL=plugin.js.map
