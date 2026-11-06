package com.ufv_rn_poc.video

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.FrameLayout
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.io.File

class VideoCardView(context: Context) : FrameLayout(context) {

    val playerView: PlayerView = PlayerView(context).apply {
        useController = false
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER)
        setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
    }

    var player: ExoPlayer? = null
    private var sourcePath: String = ""
    private var isPaused: Boolean = false
    private var speed: Float = 1.0f

    private val progressHandler = Handler(Looper.getMainLooper())
    private val progressRunnable = object : Runnable {
        override fun run() {
            player?.let { p ->
                if (p.isPlaying) {
                    val dur = if (p.duration > 0) p.duration else 0L
                    emitEvent("onProgress", Arguments.createMap().apply {
                        putDouble("positionMs", p.currentPosition.toDouble())
                        putDouble("durationMs", dur.toDouble())
                    })
                    progressHandler.postDelayed(this, 250)
                }
            }
        }
    }

    init {
        addView(playerView)
    }

    override fun requestLayout() {
        super.requestLayout()
        post(measureAndLayout)
    }

    private val measureAndLayout = Runnable {
        measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
        )
        layout(left, top, right, bottom)
    }

    private fun resolveMediaUri(rawPath: String): Uri? {
        if (rawPath.isBlank()) return null
        return try {
            when {
                rawPath.startsWith("content://") -> Uri.parse(rawPath)
                rawPath.startsWith("file://") -> {
                    val cleanPath = Uri.parse(rawPath).path ?: rawPath.removePrefix("file://")
                    val f = File(cleanPath)
                    if (f.exists()) Uri.fromFile(f) else Uri.parse(rawPath)
                }
                rawPath.startsWith("/") -> {
                    val f = File(rawPath)
                    if (f.exists()) Uri.fromFile(f) else Uri.fromFile(File(context.filesDir, rawPath))
                }
                else -> {
                    val f = File(context.filesDir, rawPath)
                    if (f.exists()) Uri.fromFile(f) else Uri.parse(rawPath)
                }
            }
        } catch (_: Exception) {
            Uri.parse(rawPath)
        }
    }

    fun setSource(path: String) {
        if (path.isEmpty() || path == sourcePath) return
        sourcePath = path
        releasePlayer()

        val mediaUri = resolveMediaUri(path)
        if (mediaUri == null) {
            emitEvent("onError", Arguments.createMap().apply {
                putString("error", "File not found: $path")
            })
            return
        }

        try {
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build()

            val p = ExoPlayer.Builder(context)
                .setAudioAttributes(audioAttributes, true)
                .build().apply {
                    repeatMode = Player.REPEAT_MODE_OFF
                    val mediaItem = MediaItem.fromUri(mediaUri)
                    setMediaItem(mediaItem)
                    playbackParameters = PlaybackParameters(speed)
                    addListener(object : Player.Listener {
                        override fun onPlaybackStateChanged(playbackState: Int) {
                            val dur = if (duration > 0) duration else 0L
                            if (playbackState == Player.STATE_ENDED) {
                                isPaused = true
                                seekTo(0)
                                progressHandler.removeCallbacks(progressRunnable)
                                emitEvent("onPlayingChange", Arguments.createMap().apply {
                                    putBoolean("isPlaying", false)
                                    putDouble("positionMs", 0.0)
                                    putDouble("durationMs", dur.toDouble())
                                })
                            }
                            emitEvent("onPlaybackState", Arguments.createMap().apply {
                                putInt("state", playbackState)
                                putDouble("durationMs", dur.toDouble())
                            })
                        }

                        override fun onIsPlayingChanged(playing: Boolean) {
                            if (playing) {
                                progressHandler.removeCallbacks(progressRunnable)
                                progressHandler.post(progressRunnable)
                            } else {
                                progressHandler.removeCallbacks(progressRunnable)
                            }
                            val dur = if (duration > 0) duration else 0L
                            emitEvent("onPlayingChange", Arguments.createMap().apply {
                                putBoolean("isPlaying", playing)
                                putDouble("positionMs", currentPosition.toDouble())
                                putDouble("durationMs", dur.toDouble())
                            })
                        }

                        override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                            progressHandler.removeCallbacks(progressRunnable)
                            emitEvent("onError", Arguments.createMap().apply {
                                putString("error", error.message ?: "Playback error")
                            })
                        }
                    })
                    prepare()
                    if (!isPaused) {
                        play()
                    }
                }
            player = p
            playerView.player = p
        } catch (e: Exception) {
            emitEvent("onError", Arguments.createMap().apply {
                putString("error", e.message ?: "Failed to initialize player")
            })
        }
    }

    fun setPaused(paused: Boolean) {
        isPaused = paused
        player?.let { p ->
            if (paused) {
                p.pause()
            } else {
                p.play()
            }
        }
    }

    fun setSpeed(s: Float) {
        speed = s
        player?.playbackParameters = PlaybackParameters(s)
    }

    fun seekTo(positionMs: Long) {
        player?.seekTo(positionMs)
    }

    private fun emitEvent(eventName: String, data: WritableMap) {
        val reactContext = context as? ReactContext ?: return
        reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, eventName, data)
    }

    fun releasePlayer() {
        progressHandler.removeCallbacks(progressRunnable)
        player?.release()
        player = null
        playerView.player = null
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        releasePlayer()
    }
}

class VideoCardViewManager : SimpleViewManager<VideoCardView>() {

    override fun getName(): String = "VideoCardView"

    override fun createViewInstance(reactContext: ThemedReactContext): VideoCardView {
        return VideoCardView(reactContext)
    }

    @ReactProp(name = "source")
    fun setSource(view: VideoCardView, source: String?) {
        source?.let { view.setSource(it) }
    }

    @ReactProp(name = "paused")
    fun setPaused(view: VideoCardView, paused: Boolean) {
        view.setPaused(paused)
    }

    @ReactProp(name = "playbackSpeed")
    fun setPlaybackSpeed(view: VideoCardView, speed: Float) {
        view.setSpeed(speed)
    }

    @ReactProp(name = "seekToMs")
    fun setSeekToMs(view: VideoCardView, pos: Double) {
        if (pos >= 0) {
            view.seekTo(pos.toLong())
        }
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
        return mutableMapOf(
            "onPlaybackState" to mapOf("registrationName" to "onPlaybackState"),
            "onPlayingChange" to mapOf("registrationName" to "onPlayingChange"),
            "onProgress" to mapOf("registrationName" to "onProgress"),
            "onError" to mapOf("registrationName" to "onError")
        )
    }
}
