//
//  Constant.swift
//  Plugin
//
//  Created by priyankpat on 2020-05-28.
//  Copyright © 2022 Martin Donadieu. All rights reserved.
//

public class Constant {
    // Parameter keys
    public static let FadeIn = "fadeIn"
    public static let FadeOut = "fadeOut"
    public static let FadeInDuration = "fadeInDuration"
    public static let FadeOutDuration = "fadeOutDuration"
    public static let FadeOutStartTime = "fadeOutStartTime"
    public static let FadeDuration = "duration"
    public static let FocusAudio = "focus"
    public static let AssetPath = "assetPath"
    public static let AssetId = "assetId"
    public static let Volume = "volume"
    public static let Time = "time"
    public static let Rate = "rate"
    public static let Loop = "loop"
    public static let Background = "background"
    public static let IgnoreSilent = "ignoreSilent"

    // Default values - used for consistency across the plugin
    public static let DefaultVolume: Float = 1.0
    public static let DefaultRate: Float = 1.0
    public static let DefaultChannels: Int = 1
    public static let DefaultFadeDuration: Float = 1.0
    public static let MinRate: Float = 0.25
    public static let MaxRate: Float = 4.0
    public static let MinVolume: Float = 0.0
    public static let MaxVolume: Float = 1.0
    public static let MaxChannels: Int = 32

    // Error messages
    public static let ErrorAssetId = "Asset Id is missing"
    public static let ErrorAssetPath = "Asset Path is missing"
    public static let ErrorAssetNotFound = "Asset is not loaded"
    public static let ErrorAssetAlreadyLoaded = "Asset is already loaded"
}
