package com.rhythmlab.companion

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
        readSharedUrl(intent)?.let(urlInput::setText)
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun startPipeline() {
        val url = urlInput.text.toString().trim()
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
        progressBar.progress = 0
        statusText.text = "시작 중…"
        openWebButton.visibility = View.GONE

        executor.execute {
            var audioFile: java.io.File? = null
            var videoFile: java.io.File? = null
            try {
                val media = YoutubeEngine.extractMedia(this, url) { progress, message ->
                    runOnUiThread {
                        progressBar.progress = progress.coerceIn(0, 100)
                        statusText.text = message
                    }
                }
                audioFile = media.audio
                videoFile = media.video

                runOnUiThread {
                    progressBar.progress = 100
                    statusText.text = "AI 채보 분석 서버로 업로드 중…"
                }
                val result = RhythmApi.analyze(media.audio, difficulty, seed)
                val song = store.save(result.analysis, media.audio, media.video, videoId, media.originalTitle, media.thumbnail)
                lastSongId = song.id

                runOnUiThread {
                    setBusy(false)
                    statusText.text = "채보 저장 완료! 앱에서 플레이하는 중…"
                    openWebButton.visibility = View.VISIBLE
                    refreshSongs()
                    openSong(song.id)
                }
            } catch (t: Throwable) {
                runOnUiThread {
                    setBusy(false)
                    progressBar.progress = 0
                    statusText.text = "실패: ${t.message ?: t.javaClass.simpleName}"
                }
            } finally {
                audioFile?.delete()
                videoFile?.delete()
            }
        }
    }

    private fun setBusy(busy: Boolean) {
        startButton.isEnabled = !busy
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
        host == "youtu.be" || host == "youtube.com" || host.endsWith(".youtube.com")
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
