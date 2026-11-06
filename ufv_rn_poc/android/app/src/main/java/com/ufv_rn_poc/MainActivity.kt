package com.ufv_rn_poc

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.ufv_rn_poc.archive.ArchiveModule
import java.util.ArrayList

class MainActivity : ReactActivity() {

  companion object {
    var cachedSharedFile: WritableMap? = null
    var initialIntent: Intent? = null

    fun extractUriFromIntent(intent: Intent?): Uri? {
      if (intent == null) return null
      // 1. Check intent.data
      intent.data?.let { return it }
      // 2. Check ClipData (Standard in WhatsApp / Telegram / Gmail)
      intent.clipData?.let { clip ->
        if (clip.itemCount > 0) {
          clip.getItemAt(0)?.uri?.let { return it }
        }
      }
      // 3. Check EXTRA_STREAM (ACTION_SEND / ACTION_SEND_MULTIPLE)
      if (intent.hasExtra(Intent.EXTRA_STREAM)) {
        try {
          val extra = intent.extras?.get(Intent.EXTRA_STREAM)
          if (extra is Uri) {
            return extra
          } else if (extra is ArrayList<*> && extra.isNotEmpty()) {
            val first = extra[0]
            if (first is Uri) return first
            if (first is String) return Uri.parse(first)
          }
        } catch (_: Exception) {}
      }
      return null
    }
  }

  override fun getMainComponentName(): String = "ufv_rn_poc"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
      super.onCreate(savedInstanceState)
      try {
          androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
      } catch (_: Exception) {}
      applyGlobalImmersiveMode()
      try {
          window.decorView.setOnSystemUiVisibilityChangeListener { visibility ->
              if ((visibility and View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) {
                  applyGlobalImmersiveMode()
              }
          }
      } catch (_: Exception) {}
      intent?.let {
          handleIncomingFileIntent(it)
      }
  }

  override fun onResume() {
      super.onResume()
      applyGlobalImmersiveMode()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
      super.onWindowFocusChanged(hasFocus)
      if (hasFocus) {
          applyGlobalImmersiveMode()
      }
  }

  private fun applyGlobalImmersiveMode() {
      runOnUiThread {
          try {
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                  window.insetsController?.let { controller ->
                      controller.hide(
                          WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars()
                      )
                      controller.systemBarsBehavior =
                          WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                  }
              } else {
                  @Suppress("DEPRECATION")
                  window.decorView.systemUiVisibility = (
                      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                      or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                      or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                      or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                      or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                      or View.SYSTEM_UI_FLAG_FULLSCREEN
                  )
              }
          } catch (_: Exception) {}
      }
  }

  override fun onNewIntent(intent: Intent?) {
      super.onNewIntent(intent)
      setIntent(intent)
      intent?.let {
          handleIncomingFileIntent(it)
      }
  }

  private fun handleIncomingFileIntent(intent: Intent) {
      val uri = extractUriFromIntent(intent) ?: return
      try {
          // Immediately cache the incoming stream safely while permissions are live
          val cachedInfo = ArchiveModule.cacheIncomingUri(this, uri, intent.type)
          if (cachedInfo != null) {
              val map = Arguments.createMap().apply {
                  putString("uri", "file://${cachedInfo.file.absolutePath}")
                  putString("path", cachedInfo.file.absolutePath)
                  putString("name", cachedInfo.name)
                  putDouble("size", cachedInfo.size.toDouble())
                  putString("mimeType", cachedInfo.mimeType)
                  putString("action", intent.action)
              }
              cachedSharedFile = map
              initialIntent = intent

              // If React Native context is already active (warm start), emit event
              try {
                  val reactContext = reactInstanceManager?.currentReactContext
                  if (reactContext != null) {
                      ArchiveModule.sendSharedFileEvent(reactContext, map)
                  }
              } catch (_: Exception) {}
          }
      } catch (e: Exception) {
          android.util.Log.w("MainActivity", "Failed to cache incoming intent: ${e.message}")
      }
  }

  override fun onDestroy() {
      ArchiveModule.stopActivePlayback()
      super.onDestroy()
  }
}


