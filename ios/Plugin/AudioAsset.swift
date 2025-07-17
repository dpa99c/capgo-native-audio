//
//  AudioAsset.swift
//  Plugin
//
//  Created by priyank on 2020-05-29.
//  Copyright © 2022 Martin Donadieu. All rights reserved.
//

import Foundation
import AVFoundation
import os.log

/**
 * AudioAsset class handles local audio playback via AVAudioPlayer
 * Supports volume control, fade effects, rate changes, and looping
 */
public class AudioAsset: NSObject, AVAudioPlayerDelegate {

    open var channels: [AVAudioPlayer] = []
    open var playIndex: Int = 0
    open var assetId: String = ""
    open var initialVolume: Float = 1.0
    public let zeroVolume: Float = 0.001 // Minimum volume to avoid zero for exponential fade
    public let maxVolume: Float = 1.0
    open weak var owner: NativeAudio?
    private var logger = Logger(logTag: "AudioAsset")

    // Constants for fade effect
    public let fadeDelaySecs: Float = 0.08

    open var currentTimeTimer: Timer?
    open var fadeTimer: Timer?

    open var fadeTask: DispatchWorkItem?
    public let fadeQueue: DispatchQueue = DispatchQueue(label: "com.audioasset.fadeQueue")

    open var dispatchedCompleteMap: [String: Bool] = [:]

    /**
     * Initialize a new audio asset
     * - Parameters:
     *   - owner: The plugin that owns this asset
     *   - assetId: Unique identifier for this asset
     *   - path: File path to the audio file
     *   - channels: Number of simultaneous playback channels (polyphony)
     *   - volume: Initial volume (0.0-1.0)
     */
    init(owner: NativeAudio, withAssetId assetId: String, withPath path: String!, withChannels channels: Int!, withVolume volume: Float!) {

        self.owner = owner
        self.assetId = assetId
        self.channels = []
        self.initialVolume = min(max(volume ?? Constant.DefaultVolume, Constant.MinVolume), Constant.MaxVolume) // Validate volume range

        super.init()

        guard let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            logger.error("Failed to encode path: %@", String(describing: path))
            return
        }

        // Try to create URL from string first, fall back to file URL if that fails
        let pathUrl: URL
        if let url = URL(string: encodedPath) {
            pathUrl = url
        } else {
            pathUrl = URL(fileURLWithPath: encodedPath)
        }

        // Limit channels to a reasonable maximum to prevent resource issues
        let channelCount = min(max(channels ?? 1, 1), Constant.MaxChannels)
        
        // Create the players directly on the current queue when in test mode
        // to avoid potential deadlocks
        let setupBlock = { [weak self] in
            guard let self = self else { return }
            for _ in 0..<channelCount {
                do {
                    let player = try AVAudioPlayer(contentsOf: pathUrl)
                    player.delegate = self
                    player.enableRate = true
                    player.volume = self.initialVolume
                    player.rate = 1.0
                    player.prepareToPlay()
                    self.channels.append(player)
                } catch {
                    logger.error("Error loading audio file: %@ - path: %@", error.localizedDescription, String(describing: path))
                }
            }
        }
        
        // In test mode, run setup directly to avoid deadlock
        if owner.isRunningTests {
            setupBlock()
        } else {
            owner.executeOnAudioQueue(setupBlock)
        }
    }

    deinit {
        stopCurrentTimeUpdates()
        stopFadeTimer()
        cancelFade()
        for player in channels {
            if player.isPlaying {
                player.stop()
            }
        }
        channels.removeAll()
        dispatchedCompleteMap.removeAll()
    }

    /**
     * Get the current playback time asynchronously
     * - Parameter callback: Closure to receive current time in seconds
     */
    func getCurrentTime(callback: @escaping (TimeInterval) -> Void) {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { callback(0); return }
            if channels.isEmpty || playIndex >= channels.count {
                callback(0)
                return
            }
            let player = channels[playIndex]
            callback(player.currentTime)
        }
    }

    /**
     * Set the current playback time
     * - Parameter time: Time in seconds
     */
    func setCurrentTime(time: TimeInterval) {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            if channels.isEmpty || playIndex >= channels.count {
                return
            }
            let player = channels[playIndex]
            // Ensure time is valid
            let validTime = min(max(time, 0), player.duration)
            player.currentTime = validTime
        }
    }

    /**
     * Get the total duration of the audio file asynchronously
     * - Parameter callback: Closure to receive duration in seconds
     */
    func getDuration(callback: @escaping (TimeInterval) -> Void) {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { callback(0); return }
            if channels.isEmpty || playIndex >= channels.count {
                callback(0)
                return
            }
            let player = channels[playIndex]
            callback(player.duration)
        }
    }

    /**
     * Play the audio from the specified time with optional delay
     * - Parameters:
     *   - time: Start time in seconds
     *   - volume: Volume level (0.0-1.0)
     */
    func play(time: TimeInterval, volume: Float? = nil) {
        stopCurrentTimeUpdates()
        stopFadeTimer()

        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            guard !channels.isEmpty else { return }

            // Reset play index if it's out of bounds
            if playIndex >= channels.count {
                playIndex = 0
            }

            // Ensure the audio session is active before playing
            owner?.activateSession()

            let player = channels[playIndex]
            // Ensure time is within valid range
            let validTime = min(max(time, 0), player.duration)
            player.currentTime = validTime
            player.numberOfLoops = 0
            player.volume = volume ?? self.initialVolume
            player.play()

            playIndex = (playIndex + 1) % channels.count
            startCurrentTimeUpdates()
        }
    }

    /**
     * Play the audio with fade-in effect
     * - Parameters:
     *   - time: Start time in seconds
     *   - volume: Volume level (0.0-1.0)
     *   - fadeInDuration: Duration of the fade-in effect in seconds
     */
    func playWithFade(time: TimeInterval, volume: Float?, fadeInDuration: TimeInterval) {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            guard !channels.isEmpty else { return }

            if playIndex >= channels.count {
                playIndex = 0
            }

            let player = channels[playIndex]
            player.currentTime = time

            if !player.isPlaying {
                player.numberOfLoops = 0
                player.volume = 0
                player.play()
                playIndex = (playIndex + 1) % channels.count
                startCurrentTimeUpdates()

                self.fadeIn(audio: player, fadeInDuration: fadeInDuration, targetVolume: volume ?? self.initialVolume)
            }
        }
    }

    func fadeIn(audio: AVAudioPlayer, fadeInDuration: TimeInterval, targetVolume: Float) {
        cancelFade() // Cancel any ongoing fade
        let steps = Int(fadeInDuration / TimeInterval(fadeDelaySecs))
        guard steps > 0 else { return }
        let startVolume: Float = audio.volume
        let fadeStep = (targetVolume - startVolume) / Float(steps)
        var currentVolume: Float = startVolume

        getCurrentTime { startTime in
            self.logger.debug("Beginning fade in at time %2f over @%2f seconds to target volume %2f in %d steps (step duration: %2fs)", startTime, fadeInDuration, targetVolume, steps, self.fadeDelaySecs)
        }
        var task: DispatchWorkItem!
        task = DispatchWorkItem { [weak self] in
            guard !task.isCancelled else { return }
            self?.isPlaying { isPlaying in
                guard let strongSelf = self, isPlaying, audio.isPlaying else {
                    task.cancel()
                    return
                }
                for _ in 0..<steps {
                    let previousCurrentVolume = currentVolume
                    currentVolume += fadeStep
                    let thisTargetVolume = min(max(currentVolume, 0), targetVolume)
                    DispatchQueue.main.async {
                        self?.isPlaying { isPlaying in
                            guard let strongerSelf = self, isPlaying, audio.isPlaying else {
                                task.cancel()
                                return
                            }
                            strongerSelf.logger.verbose("Fade in step: from %2f to %2f to target %2f", previousCurrentVolume, currentVolume, thisTargetVolume)
                            audio.volume = thisTargetVolume
                        }
                    }
                    Thread.sleep(forTimeInterval: TimeInterval(strongSelf.fadeDelaySecs))
                }
                strongSelf.getCurrentTime { endTime in
                    strongSelf.logger.debug("Fade in complete at time %2f", endTime)
                }
            }
        }
        fadeTask = task
        fadeQueue.async(execute: task)
    }

    func fadeOut(audio: AVAudioPlayer, fadeOutDuration: TimeInterval, toPause: Bool = false) {
        cancelFade() // Cancel any ongoing fade
        let steps = Int(fadeOutDuration / TimeInterval(fadeDelaySecs))
        guard steps > 0 else { return }
        var currentVolume: Float = audio.volume
        let fadeStep = currentVolume / Float(steps)

        getCurrentTime { startTime in
            self.logger.debug("Beginning fade out from volume %2f at time %2f over @%2f seconds in %d steps (step duration: %2fs)", currentVolume, startTime, fadeOutDuration, steps, self.fadeDelaySecs)
        }
        var task: DispatchWorkItem!
        task = DispatchWorkItem { [weak self] in
            for _ in 0..<steps {
                guard !task.isCancelled else { return }
                self?.isPlaying { isPlaying in
                    guard let strongSelf = self, isPlaying, audio.isPlaying else {
                        task.cancel()
                        return
                    }
                    let previousCurrentVolume = currentVolume
                    currentVolume -= fadeStep
                    DispatchQueue.main.async {
                        self?.isPlaying { isPlaying in
                            guard let strongerSelf = self, isPlaying, audio.isPlaying else {
                                task.cancel()
                                return
                            }
                            let thisTargetVolume = max(currentVolume, 0)
                            strongerSelf.logger.verbose("Fade out step: from %2f to %2f to target %2f", previousCurrentVolume, currentVolume, thisTargetVolume)
                            audio.volume = thisTargetVolume
                        }
                    }
                    Thread.sleep(forTimeInterval: TimeInterval(strongSelf.fadeDelaySecs))
                }
            }
            DispatchQueue.main.async { [weak self] in
                self?.isPlaying { isPlaying in
                    guard let strongSelf = self, isPlaying, audio.isPlaying else {
                        return
                    }
                    if toPause {
                        audio.pause()
                    } else {
                        audio.stop()
                        strongSelf.owner?.notifyListeners("complete", data: [
                            "assetId": strongSelf.assetId as Any
                        ])
                        strongSelf.dispatchedCompleteMap[strongSelf.assetId] = true
                    }
                    strongSelf.getCurrentTime { endTime in
                        strongSelf.logger.debug("Fade out complete at time %2f", endTime)
                    }
                }
            }
        }
        fadeTask = task
        fadeQueue.async(execute: task)
    }

    func fadeTo(audio: AVAudioPlayer, fadeDuration: TimeInterval, targetVolume: Float) {
        cancelFade() // Cancel any ongoing fade

        let steps = Int(fadeDuration / TimeInterval(fadeDelaySecs))
        guard steps > 0 else { return }

        let minVolume = zeroVolume
        var currentVolume: Float = max(audio.volume, minVolume)
        let safeTargetVolume: Float = max(targetVolume, minVolume)

        // Calculate the exponential ratio
        let ratio = pow(safeTargetVolume / currentVolume, 1.0 / Float(steps))

        getCurrentTime { startTime in
            self.logger.debug("Beginning exponential fade from volume %2f to %2f at time %2f over %2f seconds in %d steps (step duration: %2fs)", currentVolume, safeTargetVolume, startTime, fadeDuration, steps, self.fadeDelaySecs)
        }

        var task: DispatchWorkItem!
        task = DispatchWorkItem { [weak self] in
            guard !task.isCancelled else { return }
            self?.isPlaying { isPlaying in
                guard let strongSelf = self, isPlaying, audio.isPlaying else {
                    task.cancel()
                    return
                }
                for _ in 0..<steps {
                    let previousCurrentVolume = currentVolume
                    currentVolume *= ratio
                    DispatchQueue.main.async {
                        self?.isPlaying { isPlaying in
                            guard let strongerSelf = self, isPlaying, audio.isPlaying else {
                                task.cancel()
                                return
                            }
                            let thisTargetVolume = min(max(currentVolume, minVolume), strongerSelf.maxVolume)
                            strongerSelf.logger.verbose("Exponential fade step: from %2f to %2f to target %2f", previousCurrentVolume, currentVolume, thisTargetVolume)
                            audio.volume = thisTargetVolume
                        }
                    }
                    Thread.sleep(forTimeInterval: TimeInterval(strongSelf.fadeDelaySecs))
                }
                strongSelf.getCurrentTime { endTime in
                    strongSelf.logger.debug("Exponential fade complete at time %2f", endTime)
                }
            }
        }
        fadeTask = task
        fadeQueue.async(execute: task)
    }

    open func cancelFade() {
        if let task = fadeTask {
            task.cancel()
        }
        fadeTask = nil
    }

    internal func stopFadeTimer() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            if let timer = self.fadeTimer {
                timer.invalidate()
                self.fadeTimer = nil
            }
        }
    }

    open func pause() {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            cancelFade()
            stopCurrentTimeUpdates()

            // Check for valid playIndex
            guard !channels.isEmpty && playIndex < channels.count else { return }

            let player = channels[playIndex]
            player.pause()
        }
    }

    open func resume() {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            // Check for valid playIndex
            guard !channels.isEmpty && playIndex < channels.count else { return }

            let player = channels[playIndex]
            let timeOffset = player.deviceCurrentTime + 0.01
            player.play(atTime: timeOffset)
            startCurrentTimeUpdates()
        }
    }

    open func stop() {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            cancelFade()
            stopCurrentTimeUpdates()
            stopFadeTimer()

            for player in channels {
                if player.isPlaying {
                    player.stop()
                }
                player.currentTime = 0
                player.numberOfLoops = 0
            }
            playIndex = 0

            self.owner?.notifyListeners("complete", data: [
                "assetId": self.assetId
            ])
            self.dispatchedCompleteMap[self.assetId] = true
        }
    }

    open func stopWithFade(fadeOutDuration: TimeInterval, toPause: Bool = false) {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            guard !channels.isEmpty && playIndex < channels.count else {
                if !toPause {
                    stop()
                }
                return
            }

            let player = channels[playIndex]
            if player.isPlaying && player.volume > 0 {
                self.fadeOut(audio: player, fadeOutDuration: fadeOutDuration, toPause: toPause)
            } else {
                if !toPause {
                    stop()
                }
            }
        }
    }

    open func loop() {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            self.stop()

            guard !channels.isEmpty && playIndex < channels.count else { return }

            let player = channels[playIndex]
            player.delegate = self
            player.numberOfLoops = -1
            player.play()
            playIndex = (playIndex + 1) % channels.count
            startCurrentTimeUpdates()
        }
    }

    open func unload() {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            cancelFade()
            self.stop()
            stopCurrentTimeUpdates()
            stopFadeTimer()
            channels.removeAll()
            dispatchedCompleteMap.removeAll()
        }
    }

    /**
     * Set the volume for all audio channels
     * - Parameter volume: Volume level (0.0-1.0)
     */
    open func setVolume(volume: NSNumber!, fadeDuration: Double) {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            cancelFade()
            // Ensure volume is in valid range
            let validVolume = min(max(volume.floatValue, Constant.MinVolume), Constant.MaxVolume)
            for player in channels {
                if player.isPlaying && fadeDuration > 0 {
                    self.logger.debug("Fade to volume %2f over @%2f seconds", validVolume, fadeDuration)
                    self.fadeTo(audio: player, fadeDuration: fadeDuration, targetVolume: validVolume)
                } else {
                    self.logger.debug("Set volume to %2f", validVolume)
                    player.volume = validVolume
                }
            }
        }
    }

    /**
     * Set the playback rate for all audio channels
     * - Parameter rate: Playback rate (0.5-2.0 is typical range)
     */
    open func setRate(rate: NSNumber!) {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            // Ensure rate is in valid range
            let validRate = min(max(rate.floatValue, Constant.MinRate), Constant.MaxRate)
            for player in channels {
                player.rate = validRate
            }
        }
    }

    /**
     * AVAudioPlayerDelegate method called when playback finishes
     */
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { return }

            self.owner?.notifyListeners("complete", data: [
                "assetId": self.assetId
            ])
            self.dispatchedCompleteMap[self.assetId] = true

            // Notify the owner that this player finished
            // The owner will check if any other assets are still playing
            owner?.audioPlayerDidFinishPlaying(player, successfully: flag)
        }
    }

    func playerDecodeError(player: AVAudioPlayer!, error: NSError!) {
        if let error = error {
            logger.error("AudioAsset decode error: %@", error.localizedDescription)
        }
    }

    /**
     * Check if the audio is playing asynchronously
     * - Parameter callback: Closure to receive playing state (Bool)
     */
    open func isPlaying(callback: @escaping (Bool) -> Void) {
        owner?.executeOnAudioQueue { [weak self] in
            guard let self = self else { callback(false); return }
            if channels.isEmpty || playIndex >= channels.count {
                callback(false)
                return
            }
            let player = channels[playIndex]
            callback(player.isPlaying)
        }
    }

    open func startCurrentTimeUpdates() {
        self.stopCurrentTimeUpdates() // Ensure no duplicate timers
        self.dispatchedCompleteMap[self.assetId] = false
        DispatchQueue.main.async { [weak self] in
            guard let strongSelf = self else { return }

            let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
                guard let strongSelf = self, let strongOwner = strongSelf.owner else {
                    strongSelf.stopCurrentTimeUpdates()
                    return
                }
                strongSelf.isPlaying { isPlaying in
                    if isPlaying {
                        strongOwner.notifyCurrentTime(strongSelf)
                    } else {
                        strongSelf.stopCurrentTimeUpdates()
                    }
                }
            }
            strongSelf.currentTimeTimer = timer
            RunLoop.current.add(timer, forMode: .common)
        }
    }

    open func stopCurrentTimeUpdates() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            logger.debug("Stop current time updates")
            if let timer = self.currentTimeTimer {
                timer.invalidate()
                self.currentTimeTimer = nil
            }
        }
    }
}
