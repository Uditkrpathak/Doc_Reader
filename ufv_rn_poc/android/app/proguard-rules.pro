# React Native ProGuard Rules
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}

# JNI Bridge for libunrar.so & native methods
-keepclasseswithmembernames class * {
    native <methods>;
}
-keep class com.ufv_rn_poc.archive.** { *; }
-keep class com.ufv_rn_poc.storage.** { *; }

# Zip4j Archive Engine
-keep class net.lingala.zip4j.** { *; }

# Media3 ExoPlayer Engine
-keep class androidx.media3.** { *; }

# WebView Bridge
-keepclassmembers class * extends android.webkit.WebViewClient {
   public void *(android.webkit.WebView, java.lang.String);
   public void *(android.webkit.WebView, java.lang.String, android.graphics.Bitmap);
}

