package com.ufv_rn_poc.video

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import java.io.File
import java.util.Locale

class VideoPlayerActivity : Activity() {

    private lateinit var rootLayout: FrameLayout
    private lateinit var playerView: PlayerView
    private lateinit var hudTextView: TextView
    private lateinit var statusTextView: TextView
    private lateinit var audioNoticeView: TextView
    private lateinit var audioOverlayLayout: LinearLayout
    private lateinit var seekButton: Button
    private lateinit var playPauseButton: Button
    private lateinit var doneButton: Button

    private var player: ExoPlayer? = null
    private var filePath: String = ""
    private var fileName: String = ""
    private var startTimeMs: Long = 0L
    private var ttffMs: Long = 0L
    private var seekStartMs: Long = 0L
    private var seekLatencyMs: Long = 0L
    private var durationMs: Long = 0L
    private var playbackStatus: String = "PREPARING"
    private var playbackError: String = ""
    private var ac3TrackUnsupported: Boolean = false
    private var ac3TrackNote: String = ""
    private var autoSeekOnStart: Boolean = false
    private var seekTriggered: Boolean = false
    private var isFinished: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        filePath = intent.getStringExtra("filePath") ?: ""
        fileName = intent.getStringExtra("fileName") ?: File(filePath).name
        autoSeekOnStart = intent.getBooleanExtra("autoSeek", false)

        // Immersive sticky fullscreen: hide status bar and navigation bar
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            window.insetsController?.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
            window.insetsController?.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
            )
        }

        rootLayout = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }

        // 1. AndroidX Media3 PlayerView with clean built-in controls (like YouTube)
        playerView = PlayerView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            )
            useController = true
            controllerShowTimeoutMs = 3000
            controllerAutoShow = true
        }
        rootLayout.addView(playerView)

        // 2. Audio-only visual placeholder
        audioOverlayLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            val lp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
            layoutParams = lp
        }
        val audioIcon = TextView(this).apply {
            text = "🎵"
            textSize = 64f
            gravity = Gravity.CENTER
        }
        audioOverlayLayout.addView(audioIcon)

        audioNoticeView = TextView(this).apply {
            text = "Audio Stream Active\n$fileName"
            setTextColor(Color.WHITE)
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 0)
        }
        audioOverlayLayout.addView(audioNoticeView)
        rootLayout.addView(audioOverlayLayout)

        // 3. Clean Modern Top Navigation Bar
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.argb(160, 15, 23, 42))
            setPadding(24, 36, 24, 20)
            val lp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
            )
            layoutParams = lp
        }

        val backBtn = TextView(this).apply {
            text = "✕"
            setTextColor(Color.WHITE)
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(12, 8, 20, 8)
            setOnClickListener {
                returnResultAndFinish()
            }
        }
        topBar.addView(backBtn)

        val cleanTitleView = TextView(this).apply {
            text = fileName
            setTextColor(Color.WHITE)
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        topBar.addView(cleanTitleView)
        rootLayout.addView(topBar)

        // 4. Background HUD references for benchmarking (Hidden from consumer UI)
        val hudLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        statusTextView = TextView(this)
        hudTextView = TextView(this)
        hudLayout.addView(statusTextView)
        hudLayout.addView(hudTextView)
        rootLayout.addView(hudLayout)

        // 5. Controls layout (hidden in favor of PlayerView controller)
        val controlsLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            visibility = View.GONE
        }
        playPauseButton = Button(this)
        seekButton = Button(this)
        doneButton = Button(this)
        controlsLayout.addView(playPauseButton)
        controlsLayout.addView(seekButton)
        controlsLayout.addView(doneButton)
        rootLayout.addView(controlsLayout)

        setContentView(rootLayout)

        // Initialize and start ExoPlayer
        initAndStartPlayer()
    }

    private fun initAndStartPlayer() {
        val file = File(filePath)
        if (!file.exists()) {
            playbackStatus = "ERROR_CORRUPT"
            playbackError = "File does not exist: $filePath"
            statusTextView.setTextColor(Color.RED)
            statusTextView.text = "ERROR: $playbackError"
            if (autoSeekOnStart) {
                rootLayout.postDelayed({ returnResultAndFinish() }, 500)
            }
            return
        }

        startTimeMs = System.currentTimeMillis()
        playbackStatus = "PREPARING"
        updateHud()

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
            .build()

        val exo = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, true)
            .build()
        player = exo
        playerView.player = exo

        exo.addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() {
                // True video TTFF via onRenderedFirstFrame
                if (ttffMs == 0L) {
                    ttffMs = System.currentTimeMillis() - startTimeMs
                    playbackStatus = "PLAYING (Video Frame Rendered)"
                    updateHud()
                    checkAutoSeek()
                }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_READY -> {
                        if (durationMs <= 0L) {
                            durationMs = exo.duration.coerceAtLeast(0L)
                        }

                        // Determine if media is audio-only (no video tracks)
                        val isVideo = exo.videoSize.width > 0 || exo.videoSize.height > 0
                        if (!isVideo) {
                            runOnUiThread {
                                audioOverlayLayout.visibility = View.VISIBLE
                            }
                        }

                        // Fallback TTFF for audio or immediate ready
                        if (ttffMs == 0L) {
                            ttffMs = System.currentTimeMillis() - startTimeMs
                            playbackStatus = if (isVideo) "PLAYING (Ready)" else "PLAYING (Audio)"
                            updateHud()
                            checkAutoSeek()
                        }

                        // Seek complete fallback if position discontinuity occurred
                        if (seekStartMs > 0L) {
                            seekLatencyMs = System.currentTimeMillis() - seekStartMs
                            seekStartMs = 0L
                            playbackStatus = "PLAYING (Post-Seek)"
                            updateHud()
                            if (autoSeekOnStart) {
                                rootLayout.postDelayed({ returnResultAndFinish() }, 500)
                            }
                        }
                    }
                    Player.STATE_ENDED -> {
                        if (ttffMs == 0L) {
                            // Ended without playing: no supported decoder available (e.g. AC3)
                            if (ac3TrackUnsupported || isAc3File(filePath)) {
                                playbackStatus = "UNSUPPORTED"
                                playbackError = "Audio format (AC3) not supported by hardware decoder on this device"
                                runOnUiThread {
                                    statusTextView.setTextColor(Color.parseColor("#fbbc04"))
                                    statusTextView.text = "Notice: $playbackError"
                                }
                            } else {
                                playbackStatus = "ERROR_CORRUPT"
                                playbackError = "Stream ended without rendering audio/video frames"
                                runOnUiThread {
                                    statusTextView.setTextColor(Color.parseColor("#ea4335"))
                                    statusTextView.text = "Error: $playbackError"
                                }
                            }
                        } else {
                            playbackStatus = "COMPLETED"
                        }
                        updateHud()
                        if (autoSeekOnStart) {
                            rootLayout.postDelayed({ returnResultAndFinish() }, 500)
                        }
                    }
                    Player.STATE_BUFFERING -> {
                        playbackStatus = "BUFFERING"
                        updateHud()
                    }
                    Player.STATE_IDLE -> {
                        // Idle state
                    }
                }
            }

            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int
            ) {
                // Seek-complete measured via onPositionDiscontinuity(SEEK)
                if (reason == Player.DISCONTINUITY_REASON_SEEK && seekStartMs > 0L) {
                    seekLatencyMs = System.currentTimeMillis() - seekStartMs
                    seekStartMs = 0L
                    playbackStatus = "PLAYING (Post-Seek)"
                    updateHud()
                    if (autoSeekOnStart) {
                        rootLayout.postDelayed({ returnResultAndFinish() }, 500)
                    }
                }
            }

            override fun onTracksChanged(tracks: Tracks) {
                var hasSupportedTrack = false
                var hasAc3Track = false

                for (group in tracks.groups) {
                    for (i in 0 until group.length) {
                        val format = group.getTrackFormat(i)
                        val mime = format.sampleMimeType ?: ""
                        val isSupported = group.isTrackSupported(i)
                        if (isSupported) {
                            hasSupportedTrack = true
                        }

                        if (mime.contains("ac3", ignoreCase = true) || 
                            mime.contains("eac3", ignoreCase = true) ||
                            isAc3File(filePath)
                        ) {
                            hasAc3Track = true
                            if (!isSupported) {
                                ac3TrackUnsupported = true
                                ac3TrackNote = "Audio track ($mime) not supported by hardware decoder on this device"
                            }
                        }
                    }
                }

                // If AC3 is the only audio and no track is supported on device
                if ((hasAc3Track && !hasSupportedTrack) || (isAc3File(filePath) && !hasSupportedTrack)) {
                    playbackStatus = "UNSUPPORTED"
                    playbackError = "Audio format (AC3) not supported by hardware decoder on this device"
                    runOnUiThread {
                        statusTextView.setTextColor(Color.parseColor("#fbbc04"))
                        statusTextView.text = "Notice: $playbackError"
                    }
                    updateHud()
                } else if (ac3TrackUnsupported) {
                    // Video plays, but AC3 audio track is unsupported
                    runOnUiThread {
                        val currentText = statusTextView.text.toString()
                        if (!currentText.contains("AC3")) {
                            statusTextView.setTextColor(Color.parseColor("#fbbc04"))
                            statusTextView.text = "$currentText\n⚠️ $ac3TrackNote"
                        }
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                handlePlayerError(error)
            }
        })

        val mediaItem = MediaItem.fromUri(Uri.fromFile(file))
        exo.setMediaItem(mediaItem)
        exo.prepare()
        exo.playWhenReady = true
    }

    private fun isAc3File(path: String): Boolean {
        return path.endsWith(".ac3", ignoreCase = true)
    }

    private fun checkAutoSeek() {
        if (autoSeekOnStart && !seekTriggered) {
            seekTriggered = true
            rootLayout.postDelayed({
                performSeek50()
            }, 200)
        }
    }

    private fun performSeek50() {
        val p = player ?: return
        val dur = p.duration
        if (dur > 0L) {
            val targetPosition = dur / 2
            seekStartMs = System.currentTimeMillis()
            playbackStatus = "SEEKING to 50% (${targetPosition / 1000}s)..."
            updateHud()
            p.seekTo(targetPosition)
        } else {
            // Cannot seek (unknown duration or live)
            seekLatencyMs = 0L
            playbackStatus = "PLAYING (Non-seekable)"
            updateHud()
            if (autoSeekOnStart) {
                rootLayout.postDelayed({ returnResultAndFinish() }, 500)
            }
        }
    }

    private fun isAc3Failure(error: PlaybackException): Boolean {
        var curr: Throwable? = error
        while (curr != null) {
            val msg = curr.message?.lowercase(Locale.US) ?: ""
            val clsName = curr.javaClass.name
            if (clsName.contains("DecoderInitializationException") ||
                clsName.contains("DecoderQueryException") ||
                msg.contains("audio/ac3") ||
                msg.contains("audio/eac3") ||
                msg.contains("ac-3") ||
                msg.contains("ac3")
            ) {
                return true
            }
            curr = curr.cause
        }
        return isAc3File(filePath)
    }

    private fun handlePlayerError(error: PlaybackException) {
        if (isAc3Failure(error)) {
            playbackStatus = "UNSUPPORTED"
            playbackError = "Audio format (AC3) not supported by hardware decoder on this device"
            statusTextView.setTextColor(Color.parseColor("#fbbc04")) // Amber
            statusTextView.text = "Notice: $playbackError"
        } else {
            playbackStatus = "ERROR_CORRUPT"
            playbackError = "ExoPlayer playback error: ${error.message ?: error.errorCodeName}"
            statusTextView.setTextColor(Color.parseColor("#ea4335")) // Red
            statusTextView.text = "Error: $playbackError"
        }
        updateHud()

        if (autoSeekOnStart) {
            rootLayout.postDelayed({
                returnResultAndFinish()
            }, 600)
        }
    }

    private fun updateHud() {
        runOnUiThread {
            statusTextView.text = "File: $fileName • Status: $playbackStatus"
            val ttffDisplay = if (ttffMs > 0L) "${ttffMs} ms" else "Measuring..."
            val seekDisplay = if (seekLatencyMs > 0L) "${seekLatencyMs} ms" else if (seekStartMs > 0L) "Seeking..." else "Not tested"
            val durDisplay = if (durationMs > 0L) String.format(Locale.US, "%.1fs", durationMs / 1000.0) else "--:--"
            hudTextView.text = "TTFF: $ttffDisplay | Seek 50%: $seekDisplay | Dur: $durDisplay"
        }
    }

    private fun returnResultAndFinish() {
        if (isFinished) return
        isFinished = true

        val resultIntent = Intent().apply {
            putExtra("ttffMs", ttffMs)
            putExtra("seekLatencyMs", seekLatencyMs)
            putExtra("durationMs", durationMs)
            val finalStatus = when {
                playbackStatus == "UNSUPPORTED" -> "UNSUPPORTED"
                playbackError.isNotEmpty() -> "ERROR_CORRUPT"
                else -> "OK"
            }
            putExtra("status", finalStatus)
            val note = if (ac3TrackUnsupported && playbackError.isEmpty()) {
                ac3TrackNote
            } else {
                playbackError
            }
            putExtra("error", note)
            putExtra("filePath", filePath)
            putExtra("fileName", fileName)
        }
        setResult(Activity.RESULT_OK, resultIntent)
        finish()
    }

    override fun onPause() {
        super.onPause()
        // Video must never play in the background or during incoming calls / interruptions
        player?.playWhenReady = false
    }

    override fun onStop() {
        super.onStop()
        player?.playWhenReady = false
    }

    override fun onDestroy() {
        try {
            player?.stop()
            player?.release()
            player = null
        } catch (ignored: Exception) {}
        super.onDestroy()
    }
}
