package com.rhythmlab.companion

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.webkit.JavascriptInterface
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebSettings
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import android.view.View
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import java.io.ByteArrayInputStream
import java.io.FileInputStream
import java.io.InputStream
import java.io.ByteArrayOutputStream
import org.json.JSONObject

/** Plays the existing web game inside the app, serving saved sessions from private app storage. */
class PlayActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var store: SavedSongStore
    private lateinit var songId: String
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var expectedWebVersion: String = ""
    private var expectedBuild: Long = 0
    private var versionRetryUsed = false
    private val coverPicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null || !::webView.isInitialized) return@registerForActivityResult
        try {
            val mime = contentResolver.getType(uri)?.lowercase().orEmpty()
            val allowed = setOf("image/jpeg", "image/png", "image/webp")
            if (mime.isNotBlank() && mime !in allowed) error("지원하지 않는 이미지 형식입니다.")
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytesLimited(12 * 1024 * 1024) }
                ?: error("이미지를 읽을 수 없습니다.")
            val source = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: error("이미지를 해석할 수 없습니다.")
            val scale = minOf(1f, 960f / maxOf(source.width, source.height).toFloat())
            val resized = if (scale < 1f) Bitmap.createScaledBitmap(source, maxOf(1, (source.width * scale).toInt()), maxOf(1, (source.height * scale).toInt()), true) else source
            val out = ByteArrayOutputStream()
            check(resized.compress(Bitmap.CompressFormat.JPEG, 86, out)) { "이미지를 저장할 수 없습니다." }
            if (resized !== source) resized.recycle()
            source.recycle()
            val dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            val quoted = JSONObject.quote(dataUrl)
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('beatdash:native-cover',{detail:$quoted}));", null)
        } catch (error: Exception) {
            val quoted = JSONObject.quote(error.message ?: "커버 이미지를 처리할 수 없습니다.")
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('beatdash:native-cover-error',{detail:$quoted}));", null)
        }
    }
    private inner class ArtworkBridge {
        @JavascriptInterface fun pickCover() { runOnUiThread { coverPicker.launch("image/*") } }
    }

    /**
     * v5 Phase 2 play-time rotation lock. The Web player calls lock() when a play session starts and
     * unlock() when it ends or leaves; the Activity is never locked outside a play session.
     */
    private var playModeActive = false
    private inner class OrientationBridge {
        // `kind` is informational: the native lock always keeps the rotation the screen has right now.
        @Suppress("UNUSED_PARAMETER")
        @JavascriptInterface fun lock(kind: String?) { runOnUiThread { if (isTrustedPage()) enterPlayMode() } }
        @JavascriptInterface fun unlock() { runOnUiThread { exitPlayMode() } }
    }

    private fun isTrustedPage(): Boolean =
        ::webView.isInitialized && Uri.parse(webView.url.orEmpty()).host == Uri.parse(RhythmApi.WEB_BASE).host

    private fun insetsController() = WindowInsetsControllerCompat(window, window.decorView)

    private fun enterPlayMode() {
        playModeActive = true
        // LOCKED keeps whatever rotation the screen has right now (portrait or landscape, incl. reverse).
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LOCKED
        // A Hold is a long press: without this the WebView may start text selection / haptic long-press on
        // the held finger, cancel its pointer and swallow the other fingers' taps. Play screen only.
        webView.setOnLongClickListener { true }
        webView.isLongClickable = false
        webView.isHapticFeedbackEnabled = false
        insetsController().apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun exitPlayMode() {
        if (!playModeActive && requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED) return
        playModeActive = false
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        if (::webView.isInitialized) {
            webView.setOnLongClickListener(null)
            webView.isLongClickable = true
            webView.isHapticFeedbackEnabled = true
        }
        insetsController().show(WindowInsetsCompat.Type.systemBars())
    }
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback
        fileCallback = null
        val chosen = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            ?.filter { uri ->
                uri.scheme == "content" &&
                    packageManager.resolveContentProvider(uri.authority.orEmpty(), 0)?.packageName != packageName &&
                    checkUriPermission(uri, android.os.Process.myPid(), android.os.Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED
            }?.toTypedArray()?.takeIf { it.isNotEmpty() }
        callback?.onReceiveValue(chosen)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SavedSongStore(this)
        songId = intent.getStringExtra(EXTRA_SONG_ID).orEmpty()
        val song = store.list().firstOrNull { it.id == songId }
        val entryView = intent.getStringExtra(EXTRA_VIEW)?.takeIf { it in setOf("library", "settings") }
        if (song == null && entryView == null) { finish(); return }

        webView = WebView(this)
        // Edge-to-edge safe: pad the WebView container by the system bar / display cutout insets so the
        // full-screen player never draws under the status bar, gesture bar or notch (targetSdk 35).
        val root = FrameLayout(this)
        root.setBackgroundColor(0xFF08070D.toInt())
        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            WindowInsetsCompat.CONSUMED
        }
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.cacheMode = WebSettings.LOAD_NO_CACHE
        webView.visibility = View.INVISIBLE
        webView.settings.allowFileAccess = false
        webView.addJavascriptInterface(ArtworkBridge(), "BeatdashArtwork")
        webView.addJavascriptInterface(OrientationBridge(), "BeatdashOrientation")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = null
                val origin = Uri.parse(view.url.orEmpty())
                if (origin.scheme != "https" || origin.host != Uri.parse(RhythmApi.WEB_BASE).host) {
                    callback.onReceiveValue(null)
                    return true
                }
                fileCallback = callback
                try { filePicker.launch(params.createIntent()) }
                catch (_: ActivityNotFoundException) { fileCallback = null; callback.onReceiveValue(null) }
                return true
            }
        }
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        expectedWebVersion = packageInfo.versionName.orEmpty()
        expectedBuild = if (android.os.Build.VERSION.SDK_INT >= 28) packageInfo.longVersionCode else packageInfo.versionCode.toLong()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame || request.url.host == Uri.parse(RhythmApi.WEB_BASE).host) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                // A new page means no play session survives: never leave the app rotation-locked.
                exitPlayMode()
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                val uri = Uri.parse(url)
                if (uri.host != Uri.parse(RhythmApi.WEB_BASE).host) return
                view.evaluateJavascript("String(window.__BEATDASH_VERSION__ || '')") { raw ->
                    val actual = raw.orEmpty().trim().removeSurrounding("\"")
                    if (actual == expectedWebVersion) {
                        versionRetryUsed = false
                        view.visibility = View.VISIBLE
                        return@evaluateJavascript
                    }
                    if (!versionRetryUsed) {
                        versionRetryUsed = true
                        view.clearCache(true)
                        val refreshed = uri.buildUpon().appendQueryParameter("webRefresh", expectedBuild.toString()).build().toString()
                        view.loadUrl(refreshed)
                        return@evaluateJavascript
                    }
                    view.stopLoading()
                    view.visibility = View.INVISIBLE
                    AlertDialog.Builder(this@PlayActivity)
                        .setTitle("앱 화면 업데이트 필요")
                        .setMessage("APK는 ${expectedWebVersion}인데 Web 화면은 ${actual.ifBlank { "확인 불가" }}입니다. 오래된 화면으로 플레이하지 않도록 실행을 중단했습니다. Web 배포 후 다시 열어 주세요.")
                        .setCancelable(false)
                        .setPositiveButton("닫기") { _, _ -> finish() }
                        .show()
                }
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                if (url.scheme != "https" || url.host != Uri.parse(RhythmApi.WEB_BASE).host || request.method !in setOf("GET", "HEAD")) return null
                val match = Regex("^/api/(session|media|video|thumbnail)/([a-f0-9]{32})$").matchEntire(url.path.orEmpty()) ?: return null
                val localId = match.groupValues[2]
                // Web Library can select another saved song without recreating this Activity.
                if (!store.session(localId).isFile) return null
                return when (match.groupValues[1]) {
                    "session" -> fileResponse(store.session(localId), "application/json", request)
                    "media" -> fileResponse(store.audio(localId), "audio/wav", request)
                    "video" -> fileResponse(store.video(localId), "video/mp4", request)
                    "thumbnail" -> fileResponse(store.thumbnail(localId), "image/jpeg", request)
                    else -> null
                }
            }
        }

        val url = if (song != null) "${RhythmApi.WEB_BASE}/?session=${Uri.encode(song.id)}&saved=1" else "${RhythmApi.WEB_BASE}/?view=$entryView"
        webView.loadUrl("$url&nativeVersion=${Uri.encode(expectedWebVersion)}&nativeBuild=$expectedBuild&webRefresh=$expectedBuild")
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            // v5 Phase 2: during gameplay Back opens the Pause menu (the Web player cleans up and decides);
            // only when the page does not handle it does the Activity close.
            override fun handleOnBackPressed() {
                if (!::webView.isInitialized || webView.visibility != View.VISIBLE) { finish(); return }
                webView.evaluateJavascript(BACK_SCRIPT) { result -> if (result != "true") finish() }
            }
        })
    }

    private fun InputStream.readBytesLimited(limit: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = read(buffer)
            if (count < 0) break
            check(output.size() + count <= limit) { "이미지 파일이 너무 큽니다." }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun fileResponse(file: File, mime: String, request: WebResourceRequest): WebResourceResponse {
        if (!file.isFile) return WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), "Not Found".byteInputStream())
        val size = file.length()
        val rangeHeader = request.requestHeaders.entries.firstOrNull { it.key.equals("Range", true) }?.value
        val range = rangeHeader?.let { ByteRange.parse(it, size) }
        if (rangeHeader != null && range == null) {
            return WebResourceResponse(mime, null, 416, "Range Not Satisfiable",
                mapOf("Content-Range" to "bytes */$size", "Cache-Control" to "no-store"), ByteArrayInputStream(byteArrayOf()))
        }
        val start = range?.start ?: 0L
        val end = range?.end ?: (size - 1)
        val length = end - start + 1
        val stream = FileInputStream(file)
        stream.channel.position(start)
        val headers = mutableMapOf("Accept-Ranges" to "bytes", "Content-Length" to length.toString(), "Cache-Control" to "no-store")
        if (range != null) headers["Content-Range"] = "bytes $start-$end/$size"
        return WebResourceResponse(mime, null, if (range != null) 206 else 200,
            if (range != null) "Partial Content" else "OK", headers, if (request.method == "HEAD") { stream.close(); ByteArrayInputStream(byteArrayOf()) } else LimitedStream(stream, length))
    }

    private class LimitedStream(private val source: InputStream, private var left: Long) : InputStream() {
        override fun read(): Int {
            if (left <= 0) return -1
            val value = source.read()
            if (value >= 0) left--
            return value
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (length == 0) return 0
            if (left <= 0) return -1
            val count = source.read(buffer, offset, minOf(length.toLong(), left).toInt())
            if (count > 0) left -= count
            return count
        }
        override fun close() = source.close()
    }

    override fun onPause() {
        if (::webView.isInitialized) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('beatdash:pause')); document.querySelectorAll('audio,video').forEach(m => m.pause());", null)
            webView.onPause()
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        // The system may show the bars again while the app was in the background; Pause keeps the lock.
        if (playModeActive) insetsController().hide(WindowInsetsCompat.Type.systemBars())
        if (::webView.isInitialized) {
            webView.onResume()
            webView.evaluateJavascript("window.dispatchEvent(new Event('beatdash:resume'));", null)
        }
    }

    override fun onDestroy() {
        exitPlayMode()
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_SONG_ID = "song_id"
        const val EXTRA_VIEW = "entry_view"
        private const val BACK_SCRIPT = "(function(){try{return !!(window.__beatdashBack && window.__beatdashBack());}catch(e){return false;}})()"
    }
}
