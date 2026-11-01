package com.ufv_rn_poc

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.content.Intent
import com.ufv_rn_poc.archive.ArchiveModule

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "ufv_rn_poc"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onNewIntent(intent: Intent?) {
      super.onNewIntent(intent)
      setIntent(intent)
      intent?.let { ArchiveModule.handleIncomingIntent(reactInstanceManager.currentReactContext, it) }
  }
}

