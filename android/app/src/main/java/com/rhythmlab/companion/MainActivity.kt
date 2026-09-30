package com.rhythmlab.companion

import android.content.ClipboardManager
import android.content.Context
import android.text.Editable
import android.text.TextWatcher
import android.widget.ImageView
import android.graphics.BitmapFactory
import android.view.inputmethod.InputMethodManager
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.graphics.Color
import android.app.AlertDialog
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var urlInput: EditText
    private lateinit var difficultySpinner: Spinner
    private lateinit var seedInput: EditText
    private lateinit var startButton: Button
    private lateinit var openWebButton: Button
    private lateinit var progressBar: ProgressBar
    private lateinit var statusText: TextView
    private lateinit var savedSongs: LinearLayout
    private lateinit var pasteButton: Button
    private lateinit var previewButton: Button
    private lateinit var previewCard: LinearLayout
    private lateinit var previewTitle: TextView
    private lateinit var previewMeta: TextView
    private lateinit var previewImage: ImageView
    private var previewUrl: String? = null
    private var busy = false
    private var previewGeneration = 0
    private val thumbnailClient = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build()
    private lateinit var store: SavedSongStore

    private val executor = Executors.newSingleThreadExecutor()
    private var lastSongId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = SavedSongStore(this)

        urlInput = findViewById(R.id.urlInput)
        difficultySpinner = findViewById(R.id.difficultySpinner)
        seedInput = findViewById(R.id.seedInput)
        startButton = findViewById(R.id.startButton)
        openWebButton = findViewById(R.id.openWebButton)
        progressBar = findViewById(R.id.progressBar)
        statusText = findViewById(R.id.statusText)
        savedSongs = findViewById(R.id.savedSongs)

        pasteButton = findViewById(R.id.pasteButton)
        previewButton = findViewById(R.id.previewButton)
        previewCard = findViewById(R.id.previewCard)
        previewTitle = findViewById(R.id.previewTitle)
        previewMeta = findViewById(R.id.previewMeta)
        previewImage = findViewById(R.id.previewImage)
        startButton.isEnabled = false
        pasteButton.setOnClickListener {
            // Read only on a user gesture. Nothing is sent until URL 불러오기 is tapped.
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val text = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty()
            val link = URL_REGEX.find(text)?.value
            if (link == null) statusText.text = "클립보드에서 YouTube 링크를 찾지 못했습니다."
            else urlInput.setText(link)
        }
        previewButton.setOnClickListener { loadPreview() }
        urlInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) { }
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                previewGeneration++
                previewUrl = null
                previewCard.visibility = View.GONE
                startButton.isEnabled = false
            }
            override fun afterTextChanged(s: Editable?) { }
        })
        urlInput.setOnEditorActionListener { _, _, _ -> if (!busy) loadPreview(); true }
        findViewById<Button>(R.id.libraryButton).setOnClickListener {
            startActivity(Intent(this, PlayActivity::class.java).putExtra(PlayActivity.EXTRA_VIEW, "library"))
        }
        findViewById<Button>(R.id.settingsButton).setOnClickListener {
            startActivity(Intent(this, PlayActivity::class.java).putExtra(PlayActivity.EXTRA_VIEW, "settings"))
        }

        val difficulties = listOf("Easy", "Normal", "Hard", "Expert")
        difficultySpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            difficulties,
        )
        difficultySpinner.setSelection(2)

        readSharedUrl(intent)?.let(urlInput::setText)
        startButton.setOnClickListener { startPipeline() }
        openWebButton.setOnClickListener { lastSongId?.let(::openSong) }
        refreshSongs()
    }

    override fun onResume() {
        super.onResume()
        if (::savedSongs.isInitialized) refreshSongs()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!busy) readSharedUrl(intent)?.let(urlInput::setText)
    }

    override fun onDestroy() {
        previewGeneration++
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun ui(action: () -> Unit) = runOnUiThread {
        if (!isFinishing && !isDestroyed) action()
    }

    private fun loadPreview() {
        if (busy) return
        val url = urlInput.text.toString().trim()
        if (!isYoutubeUrl(url) || extractVideoId(url) == null) {
            urlInput.error = "올바른 YouTube 영상 링크를 입력해 주세요."
            return
        }
        val generation = ++previewGeneration
        previewUrl = null
        previewCard.visibility = View.GONE
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(urlInput.windowToken, 0)
        urlInput.clearFocus()
        setBusy(true)
        statusText.text = "영상 정보 확인 중…"
        executor.execute {
            try {
                val info = YoutubeEngine.preview(this, url)
                val bitmap = runCatching {
                    val uri = Uri.parse(info.thumbnail)
                    if (uri.scheme != "https" || !(uri.host.orEmpty() == "i.ytimg.com" || uri.host.orEmpty().endsWith(".ytimg.com"))) return@runCatching null
                    thumbnailClient.newCall(Request.Builder().url(info.thumbnail).build()).execute().use { response ->
                        check(response.isSuccessful)
                        val body = response.body ?: return@use null
                        val bytes = body.byteStream().use { it.readBytesLimited(4 * 1024 * 1024) }
                        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                        val options = BitmapFactory.Options().apply {
                            inSampleSize = 1
                            while (bounds.outWidth / inSampleSize > 1280 || bounds.outHeight / inSampleSize > 720) inSampleSize *= 2
                        }
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                    }
                }.getOrNull()
                ui {
                    if (generation != previewGeneration) return@ui
                    previewUrl = url
                    previewTitle.text = info.title
                    previewMeta.text = "${info.duration / 60}:${(info.duration % 60).toString().padStart(2, '0')} · ${info.channel}"
                    previewImage.setImageBitmap(bitmap)
                    previewImage.contentDescription = if (bitmap == null) "썸네일을 불러오지 못했습니다" else "원본 영상 썸네일"
                    previewCard.visibility = View.VISIBLE
                    setBusy(false)
                    statusText.text = "영상을 확인하고 채보 만들기를 눌러 주세요."
                }
            } catch (_: Exception) {
                ui {
                    if (generation != previewGeneration) return@ui
                    setBusy(false)
                    statusText.text = "영상을 불러올 수 없습니다. 링크·연결 상태를 확인해 주세요. 공개된 8분 이하 영상만 지원합니다."
                }
            }
        }
    }

    private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = read(buffer)
            if (count < 0) break
            check(output.size() + count <= limit)
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun startPipeline() {
        if (busy) return
        val url = urlInput.text.toString().trim()
        if (previewUrl != url) { loadPreview(); return }
        if (!isYoutubeUrl(url)) {
            urlInput.error = "YouTube 링크를 입력해 주세요."
            return
        }
        val videoId = extractVideoId(url)
        if (videoId == null) {
            urlInput.error = "영상 ID를 읽지 못했습니다."
            return
        }
        val difficulty = difficultySpinner.selectedItem.toString().lowercase()
        val seed = seedInput.text.toString().toIntOrNull() ?: 42

        setBusy(true)
        statusText.text = "시작 중…"
        openWebButton.visibility = View.GONE

        executor.execute {
            var audioFile: java.io.File? = null
            var videoFile: java.io.File? = null
            try {
                val media = YoutubeEngine.extractMedia(this, url) { _, message ->
                    ui {
                        statusText.text = message
                    }
                }
                audioFile = media.audio
                videoFile = media.video

                ui {
                    statusText.text = "오디오 업로드 · BPM 분석 · 채보 생성 중…"
                }
                val result = RhythmApi.analyze(media.audio, difficulty, seed)
                val song = store.save(result.analysis, media.audio, media.video, videoId, media.originalTitle, media.thumbnail)
                lastSongId = song.id

                ui {
                    setBusy(false)
                    statusText.text = "채보 저장 완료! 앱에서 플레이하는 중…"
                    openWebButton.visibility = View.VISIBLE
                    refreshSongs()
                    openSong(song.id)
                }
            } catch (_: Exception) {
                ui {
                    setBusy(false)
                    statusText.text = "채보를 만들지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요."
                }
            } finally {
                audioFile?.delete()
                videoFile?.delete()
            }
        }
    }

    private fun setBusy(busy: Boolean) {
        this.busy = busy
        startButton.isEnabled = !busy && previewUrl != null
        previewButton.isEnabled = !busy
        pasteButton.isEnabled = !busy
        progressBar.isIndeterminate = true
        progressBar.visibility = if (busy) View.VISIBLE else View.GONE
        urlInput.isEnabled = !busy
        difficultySpinner.isEnabled = !busy
        seedInput.isEnabled = !busy
    }

    private fun openSong(id: String) {
        startActivity(Intent(this, PlayActivity::class.java).putExtra(PlayActivity.EXTRA_SONG_ID, id))
    }

    private fun refreshSongs() {
        savedSongs.removeAllViews()
        val songs = store.list()
        if (songs.isEmpty()) {
            savedSongs.addView(TextView(this).apply {
                text = "아직 저장한 곡이 없어요."
                setTextColor(Color.LTGRAY)
            })
        }
        for (song in songs) {
            val button = Button(this).apply {
                text = "${song.title} · ${song.difficulty}"
                isAllCaps = false
                setOnClickListener { openSong(song.id) }
                setOnLongClickListener {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage("${song.title}을(를) 기기에서 삭제할까요?")
                        .setNegativeButton("취소", null)
                        .setPositiveButton("삭제") { _, _ -> store.delete(song.id); refreshSongs() }
                        .show()
                    true
                }
            }
            savedSongs.addView(button)
        }
    }

    private fun readSharedUrl(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return null
        val text = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
        return URL_REGEX.find(text)?.value
    }

    private fun isYoutubeUrl(raw: String): Boolean = runCatching {
        val host = Uri.parse(raw).host?.lowercase().orEmpty()
        (Uri.parse(raw).scheme in setOf("https", "http")) && Uri.parse(raw).userInfo == null && Uri.parse(raw).port == -1 && host in setOf("youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com")
    }.getOrDefault(false)

    private fun extractVideoId(raw: String): String? {
        val uri = Uri.parse(raw)
        return when {
            uri.host.equals("youtu.be", true) -> uri.pathSegments.firstOrNull()
            uri.getQueryParameter("v") != null -> uri.getQueryParameter("v")
            uri.pathSegments.firstOrNull() in setOf("shorts", "embed", "live") -> uri.pathSegments.getOrNull(1)
            else -> null
        }?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{6,20}")) }
    }

    companion object {
        private val URL_REGEX = Regex("https?://(?:www\\.|m\\.|music\\.)?(?:youtube\\.com|youtu\\.be)/[^\\s]+", RegexOption.IGNORE_CASE)
    }
}
