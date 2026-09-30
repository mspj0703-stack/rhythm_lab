package com.rhythmlab.companion

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.io.ByteArrayInputStream
import java.io.FileInputStream
import java.io.InputStream

/** Plays the existing web game inside the app, serving saved sessions from private app storage. */
class PlayActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var store: SavedSongStore
    private lateinit var songId: String
    private var fileCallback: ValueCallback<Array<Uri>>? = null
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
        setContentView(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.allowFileAccess = false
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
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame || request.url.host == Uri.parse(RhythmApi.WEB_BASE).host) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
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
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        val build = if (android.os.Build.VERSION.SDK_INT >= 28) packageInfo.longVersionCode else packageInfo.versionCode.toLong()
        webView.loadUrl("$url&nativeVersion=${Uri.encode(packageInfo.versionName.orEmpty())}&nativeBuild=$build")
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { finish() }
        })
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
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    companion object { const val EXTRA_SONG_ID = "song_id"; const val EXTRA_VIEW = "entry_view" }
}
