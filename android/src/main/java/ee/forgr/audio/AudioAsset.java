package ee.forgr.audio;

import android.content.res.AssetFileDescriptor;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.RequiresApi;
import androidx.media3.common.util.UnstableApi;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@UnstableApi
public class AudioAsset {

    public static final double DEFAULT_FADE_DURATION_MS = 1000.0;

    private final String TAG = "AudioAsset";

    private final ArrayList<AudioDispatcher> audioList;
    protected int playIndex = 0;
    protected final NativeAudio owner;
    protected AudioCompletionListener completionListener;
    protected String assetId;
    protected Handler currentTimeHandler;
    protected Runnable currentTimeRunnable;
    protected static final int FADE_DELAY_MS = 80; // Delay between fade steps in milliseconds

    protected ScheduledExecutorService fadeExecutor;
    protected ScheduledFuture<?> fadeTask;

    protected Map<String, Boolean> dispatchedCompleteMap = new HashMap<>();

    protected enum FadeState {
        NONE,
        FADE_IN,
        FADE_OUT,
        FADE_TO
    }

    protected FadeState fadeState = FadeState.NONE;

    protected final float zeroVolume = 0.001f; // Minimum volume to avoid zero for exponential fade
    protected final float maxVolume = 1.0f; // Maximum volume

    AudioAsset(NativeAudio owner, String assetId, AssetFileDescriptor assetFileDescriptor, int audioChannelNum, float volume)
        throws Exception {
        audioList = new ArrayList<>();
        this.owner = owner;
        this.assetId = assetId;
        this.fadeExecutor = Executors.newSingleThreadScheduledExecutor();

        if (audioChannelNum < 0) {
            audioChannelNum = 1;
        }

        for (int x = 0; x < audioChannelNum; x++) {
            AudioDispatcher audioDispatcher = new AudioDispatcher(assetFileDescriptor, volume);
            audioList.add(audioDispatcher);
            if (audioChannelNum == 1) audioDispatcher.setOwner(this);
        }
    }

    public void dispatchComplete() {
        if (dispatchedCompleteMap.getOrDefault(this.assetId, false)) {
            return;
        }
        this.owner.dispatchComplete(this.assetId);
        dispatchedCompleteMap.put(this.assetId, true);
    }

    public void play(double time, float volume) throws Exception {
        AudioDispatcher audio = audioList.get(playIndex);
        if (audio != null) {
            cancelFade();
            audio.play(time);
            audio.setVolume(volume);
            playIndex++;
            playIndex = playIndex % audioList.size();
            Log.d(TAG, "Starting timer from play"); // Debug log
            startCurrentTimeUpdates(); // Make sure this is called
        } else {
            throw new Exception("AudioDispatcher is null");
        }
    }

    public double getDuration() {
        if (audioList.size() != 1) return 0;

        AudioDispatcher audio = audioList.get(playIndex);

        if (audio != null) {
            return audio.getDuration();
        }
        return 0;
    }

    public void setCurrentPosition(double time) {
        if (audioList.size() != 1) return;

        AudioDispatcher audio = audioList.get(playIndex);

        if (audio != null) {
            audio.setCurrentPosition(time);
        }
    }

    public double getCurrentPosition() {
        if (audioList.size() != 1) return 0;

        AudioDispatcher audio = audioList.get(playIndex);

        if (audio != null) {
            return audio.getCurrentPosition();
        }
        return 0;
    }

    public boolean pause() throws Exception {
        stopCurrentTimeUpdates(); // Stop updates when pausing
        boolean wasPlaying = false;

        for (int x = 0; x < audioList.size(); x++) {
            AudioDispatcher audio = audioList.get(x);
            if (audio == null) {
                continue;
            }
            cancelFade();
            wasPlaying |= audio.pause();
        }

        return wasPlaying;
    }

    public void resume() throws Exception {
        if (!audioList.isEmpty()) {
            AudioDispatcher audio = audioList.get(0);
            if (audio != null) {
                audio.resume();
                Log.d(TAG, "Starting timer from resume"); // Debug log
                startCurrentTimeUpdates(); // Make sure this is called
            } else {
                throw new Exception("AudioDispatcher is null");
            }
        }
    }

    public void stop() throws Exception {
        stopCurrentTimeUpdates(); // Stop updates when stopping
        dispatchComplete();
        for (int x = 0; x < audioList.size(); x++) {
            AudioDispatcher audio = audioList.get(x);

            if (audio != null) {
                cancelFade();
                audio.stop();
            } else {
                throw new Exception("AudioDispatcher is null");
            }
        }
    }

    public void loop() throws Exception {
        AudioDispatcher audio = audioList.get(playIndex);
        if (audio != null) {
            audio.loop();
            playIndex++;
            playIndex = playIndex % audioList.size();
            startCurrentTimeUpdates(); // Add timer start
        } else {
            throw new Exception("AudioDispatcher is null");
        }
    }

    public void unload() throws Exception {
        this.stop();

        for (int x = 0; x < audioList.size(); x++) {
            AudioDispatcher audio = audioList.get(x);

            if (audio != null) {
                audio.unload();
            } else {
                throw new Exception("AudioDispatcher is null");
            }
        }

        audioList.clear();
        fadeExecutor.shutdown();
    }

    public void setVolume(float volume, double duration) throws Exception {
        for (int x = 0; x < audioList.size(); x++) {
            AudioDispatcher audio = audioList.get(x);

            cancelFade();
            if (audio != null) {
                if (isPlaying() && duration > 0) {
                    fadeTo(audio, duration, volume);
                } else {
                    audio.setVolume(volume);
                }
            } else {
                throw new Exception("AudioDispatcher is null");
            }
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.M)
    public void setRate(float rate) throws Exception {
        for (int x = 0; x < audioList.size(); x++) {
            AudioDispatcher audio = audioList.get(x);
            if (audio != null) {
                audio.setRate(rate);
            }
        }
    }

    public boolean isPlaying() throws Exception {
        for (AudioDispatcher ad : audioList) {
            if (ad.isPlaying()) return true;
        }
        return false;
    }

    public void setCompletionListener(AudioCompletionListener listener) {
        this.completionListener = listener;
    }

    protected void notifyCompletion() {
        if (completionListener != null) {
            completionListener.onCompletion(this.assetId);
        }
    }

    protected String getAssetId() {
        return assetId;
    }

    public void setCurrentTime(double time) throws Exception {
        owner
            .getActivity()
            .runOnUiThread(
                new Runnable() {
                    @Override
                    public void run() {
                        if (audioList.size() != 1) {
                            return;
                        }
                        AudioDispatcher audio = audioList.get(playIndex);
                        if (audio != null) {
                            audio.setCurrentPosition(time);
                        }
                    }
                }
            );
    }

    protected void startCurrentTimeUpdates() {
        Log.d(TAG, "Starting timer updates");
        if (currentTimeHandler == null) {
            currentTimeHandler = new Handler(Looper.getMainLooper());
        }
        // Reset completion status for this assetId
        dispatchedCompleteMap.put(assetId, false);

        // Add small delay to let audio start playing
        currentTimeHandler.postDelayed(
            new Runnable() {
                @Override
                public void run() {
                    startTimeUpdateLoop();
                }
            },
            100
        ); // 100ms delay
    }

    private void startTimeUpdateLoop() {
        currentTimeRunnable = new Runnable() {
            @Override
            public void run() {
                AudioDispatcher audio = null;
                try {
                    audio = audioList.get(playIndex);
                } catch (Exception e) {
                    Log.v(TAG, "Audio dispatcher does not exist at index " + playIndex);
                }
                if (audio == null) {
                    Log.d(TAG, "Audio dispatcher does not exist - aborting timer update");
                    return;
                }

                try {
                    if (audio != null && audio.isPlaying()) {
                        double currentTime = getCurrentPosition();
                        Log.v(TAG, "Play timer update: currentTime = " + currentTime);
                        owner.notifyCurrentTime(assetId, currentTime);
                        currentTimeHandler.postDelayed(this, 100);
                    } else {
                        Log.d(TAG, "Stopping play timer - not playing");
                        stopCurrentTimeUpdates();
                        dispatchComplete();
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error getting current time", e);
                    stopCurrentTimeUpdates();
                }
            }
        };
        currentTimeHandler.post(currentTimeRunnable);
    }

    void stopCurrentTimeUpdates() {
        Log.d(TAG, "Stopping play timer updates");
        if (currentTimeHandler != null && currentTimeRunnable != null) {
            currentTimeHandler.removeCallbacks(currentTimeRunnable);
            currentTimeHandler = null;
            currentTimeRunnable = null;
        }
    }

    public void playWithFadeIn(double time, float volume, double fadeInDurationMs) throws Exception {
        AudioDispatcher audio = audioList.get(playIndex);
        if (audio != null) {
            audio.setVolume(0);
            audio.play(time);
            fadeIn(audio, fadeInDurationMs, volume);
            startCurrentTimeUpdates();
        }
    }

    private void fadeIn(final AudioDispatcher audio, double fadeInDurationMs, float targetVolume) {
        cancelFade();
        fadeState = FadeState.FADE_IN;

        final int steps = Math.max(1, (int) (fadeInDurationMs / FADE_DELAY_MS));
        final float fadeStep = targetVolume / steps;

        Log.d(
            TAG,
            "Beginning fade in at time " +
            getCurrentPosition() +
            " over " +
            (fadeInDurationMs / 1000.0) +
            "s to target volume " +
            targetVolume +
            " in " +
            steps +
            " steps (step duration: " +
            (FADE_DELAY_MS / 1000.0) +
            "s"
        );

        fadeTask = fadeExecutor.scheduleWithFixedDelay(
            new Runnable() {
                float currentVolume = 0;

                @Override
                public void run() {
                    if (fadeState != FadeState.FADE_IN || currentVolume >= targetVolume) {
                        fadeState = FadeState.NONE;
                        cancelFade();
                        Log.d(TAG, "Fade in complete at time " + getCurrentPosition());
                        return;
                    }
                    final float previousCurrentVolume = currentVolume;
                    currentVolume += fadeStep;
                    try {
                        final float resolvedTargetVolume = Math.min(Math.max(currentVolume, 0), targetVolume);
                        Log.v(
                            TAG,
                            "Fade in step: from " + previousCurrentVolume + " to " + currentVolume + " to target " + resolvedTargetVolume
                        );
                        if (audio != null) audio.setVolume(resolvedTargetVolume);
                    } catch (Exception e) {
                        Log.e(TAG, "Error during fade in", e);
                        cancelFade();
                    }
                }
            },
            0,
            FADE_DELAY_MS,
            TimeUnit.MILLISECONDS
        );
    }

    public void stopWithFade(double fadeOutDurationMs) throws Exception {
        AudioDispatcher audio = audioList.get(playIndex);
        if (audio != null && audio.isPlaying()) {
            cancelFade();
            fadeOut(audio, fadeOutDurationMs);
        }
    }

    private void fadeOut(final AudioDispatcher audio, double fadeOutDurationMs) {
        cancelFade();
        fadeState = FadeState.FADE_OUT;

        if (audio == null) return;

        final int steps = Math.max(1, (int) (fadeOutDurationMs / FADE_DELAY_MS));
        final float initialVolume = audio.getVolume();
        final float fadeStep = initialVolume / steps;

        Log.d(
            TAG,
            "Beginning fade out from volume " +
            initialVolume +
            " at time " +
            getCurrentPosition() +
            " over " +
            (fadeOutDurationMs / 1000.0) +
            "s in " +
            steps +
            " steps (step duration: " +
            (FADE_DELAY_MS / 1000.0) +
            "s)"
        );

        fadeTask = fadeExecutor.scheduleWithFixedDelay(
            new Runnable() {
                float currentVolume = initialVolume;

                @Override
                public void run() {
                    if (fadeState != FadeState.FADE_OUT || currentVolume <= 0) {
                        fadeState = FadeState.NONE;
                        stopAudio(audio);
                        cancelFade();
                        Log.d(TAG, "Fade out complete at time " + getCurrentPosition());
                        return;
                    }
                    final float previousCurrentVolume = currentVolume;
                    currentVolume -= fadeStep;
                    try {
                        final float thisTargetVolume = Math.max(currentVolume, 0);
                        Log.v(
                            TAG,
                            "Fade out step: from " + previousCurrentVolume + " to " + currentVolume + " to target " + thisTargetVolume
                        );
                        if (audio != null) audio.setVolume(thisTargetVolume);
                    } catch (Exception e) {
                        Log.e(TAG, "Error during fade out", e);
                        cancelFade();
                    }
                }
            },
            0,
            FADE_DELAY_MS,
            TimeUnit.MILLISECONDS
        );
    }

    private void fadeTo(final AudioDispatcher audio, double fadeDurationMs, float targetVolume) {
        cancelFade();
        fadeState = FadeState.FADE_TO;

        if (audio == null) return;

        final int steps = Math.max(1, (int) (fadeDurationMs / FADE_DELAY_MS));
        final float minVolume = zeroVolume;
        final float initialVolume = Math.max(audio.getVolume(), minVolume);
        final float finalTargetVolume = Math.max(targetVolume, minVolume);

        // Calculate exponential ratio for perceptual fade
        final float safeInitialVolume = Math.max(initialVolume, zeroVolume);
        final double ratio = Math.pow(finalTargetVolume / safeInitialVolume, 1.0 / steps);

        Log.d(
            TAG,
            "Beginning exponential fade from volume " +
            initialVolume +
            " to " +
            finalTargetVolume +
            " over " +
            (fadeDurationMs / 1000.0) +
            "s in " +
            steps +
            " steps (step duration: " +
            (FADE_DELAY_MS / 1000.0) +
            "s)"
        );

        fadeTask = fadeExecutor.scheduleWithFixedDelay(
            new Runnable() {
                int currentStep = 0;
                float currentVolume = initialVolume;

                @Override
                public void run() {
                    if ((audio != null && fadeState != FadeState.FADE_TO) || !audio.isPlaying() || currentStep >= steps) {
                        fadeState = FadeState.NONE;
                        cancelFade();
                        Log.d(TAG, "Fade to complete at time " + getCurrentPosition());
                        return;
                    }

                    try {
                        currentVolume *= (float) ratio;
                        currentVolume = Math.min(Math.max(currentVolume, minVolume), maxVolume); // Clamp between minVolume and maxVolume
                        if (audio != null) audio.setVolume(currentVolume);
                        Log.v(TAG, "Fade to step " + currentStep + ": volume set to " + currentVolume);
                        currentStep++;
                    } catch (Exception e) {
                        Log.e(TAG, "Error during fade to", e);
                        cancelFade();
                    }
                }
            },
            0,
            FADE_DELAY_MS,
            TimeUnit.MILLISECONDS
        );
    }

    /**
     * Cancels the fade task if it is running.
     */
    private void cancelFade() {
        if (fadeTask != null && !fadeTask.isCancelled()) {
            fadeTask.cancel(true);
        }
        fadeState = FadeState.NONE;
        fadeTask = null;
    }

    private void stopAudio(final AudioDispatcher audio) {
        if (audio != null) {
            try {
                audio.setVolume(0);
                stop();
                cancelFade();
            } catch (Exception e) {
                Log.e(TAG, "Error stopping after fade", e);
            }
        }
    }
}
