package com.rhythmlab.companion

import android.Manifest
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
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
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
    private lateinit var batchUrlInput: EditText
    private lateinit var batchAddButton: Button
    private lateinit var jobQueue: LinearLayout
    private lateinit var queueSummary: TextView
    private lateinit var contentContainer: LinearLayout
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
    private lateinit var jobStore: ChartJobStore
    private val handler = Handler(Looper.getMainLooper())
    private val queueRefresh = object : Runnable {
        override fun run() {
            if (::jobQueue.isInitialized) refreshJobs()
            handler.postDelayed(this, 1000)
        }
    }

    private val executor = Executors.newSingleThreadExecutor()
    private var lastSongId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = SavedSongStore(this)
        jobStore = ChartJobStore(this)

        urlInput = findViewById(R.id.urlInput)
        difficultySpinner = findViewById(R.id.difficultySpinner)
        seedInput = findViewById(R.id.seedInput)
        startButton = findViewById(R.id.startButton)
        openWebButton = findViewById(R.id.openWebButton)
        progressBar = findViewById(R.id.progressBar)
        statusText = findViewById(R.id.statusText)
        savedSongs = findViewById(R.id.savedSongs)
        batchUrlInput = findViewById(R.id.batchUrlInput)
        batchAddButton = findViewById(R.id.batchAddButton)
        jobQueue = findViewById(R.id.jobQueue)
        queueSummary = findViewById(R.id.queueSummary)
        contentContainer = findViewById(R.id.contentContainer)
        applyResponsiveContentWidth()

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
        difficultySpinner.adapter = ArrayAdapter(this, R.layout.spinner_item, difficulties).also {
            it.setDropDownViewResource(R.layout.spinner_dropdown_item)
        }
        difficultySpinner.setSelection(2)

        readSharedUrl(intent)?.let(urlInput::setText)
        startButton.setOnClickListener { startPipeline() }
        batchAddButton.setOnClickListener { enqueueBatch() }
        openWebButton.setOnClickListener { lastSongId?.let(::openSong) }
        jobStore.recoverInterrupted()
        refreshSongs()
        refreshJobs()
        if (jobStore.nextRunnable() != null) ChartJobService.start(this)
    }

    override fun onResume() {
        super.onResume()
        if (::savedSongs.isInitialized) refreshSongs()
        handler.removeCallbacks(queueRefresh)
        handler.post(queueRefresh)
    }

    override fun onPause() {
        handler.removeCallbacks(queueRefresh)
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!busy) readSharedUrl(intent)?.let(urlInput::setText)
    }

    override fun onDestroy() {
        previewGeneration++
        handler.removeCallbacks(queueRefresh)
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
        val url = urlInput.text.toString().trim()
        if (previewUrl != url) { loadPreview(); return }
        enqueueUrls(listOf(url))
    }

    private fun enqueueBatch() {
        val urls = URL_REGEX.findAll(batchUrlInput.text.toString()).map { it.value.trimEnd('.', ',', ')', ']') }.distinct().toList()
        if (urls.isEmpty()) {
            batchUrlInput.error = "YouTube 링크를 하나 이상 입력해 주세요."
            return
        }
        enqueueUrls(urls)
    }

    private fun enqueueUrls(urls: List<String>) {
        val difficulty = difficultySpinner.selectedItem.toString().lowercase()
        val seed = seedInput.text.toString().toIntOrNull() ?: 42
        var added = 0
        var duplicates = 0
        var invalid = 0
        for (url in urls) {
            if (!isYoutubeUrl(url)) { invalid++; continue }
            val videoId = extractVideoId(url)
            if (videoId == null) { invalid++; continue }
            val before = jobStore.list().firstOrNull {
                it.videoId == videoId && it.difficulty == difficulty && it.seed == seed && it.status !in ChartJobStore.TERMINAL
            }
            jobStore.enqueue(url, difficulty, seed, videoId)
            if (before == null) added++ else duplicates++
        }
        if (added > 0) {
            requestNotificationPermissionIfNeeded()
            ChartJobService.start(this)
            batchUrlInput.text?.clear()
            statusText.text = buildString {
                append("${added}곡을 대기열에 추가했습니다.")
                if (duplicates > 0) append(" 중복 ${duplicates}개 제외.")
                if (invalid > 0) append(" 잘못된 링크 ${invalid}개 제외.")
            }
        } else {
            statusText.text = if (duplicates > 0) "같은 영상·난이도·seed 작업이 이미 대기열에 있습니다." else "추가할 수 있는 YouTube 링크가 없습니다."
        }
        refreshJobs()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4752)
        }
    }

    private fun refreshJobs() {
        if (!::jobQueue.isInitialized) return
        jobQueue.removeAllViews()
        val allJobs = jobStore.list().sortedByDescending { it.createdAt }
        val jobs = allJobs.take(20)
        val activeCount = allJobs.count { it.status !in ChartJobStore.TERMINAL && it.status != ChartJobStore.NEEDS_RETRY }
        queueSummary.text = if (allJobs.isEmpty()) "작업 없음" else "작업 ${allJobs.size}개 · 진행 ${activeCount}개"
        if (jobs.isEmpty()) {
            jobQueue.addView(TextView(this).apply {
                text = "대기 중인 작업이 없습니다."
                setTextColor(Color.parseColor("#8D859A"))
                textSize = 13f
                setPadding(0, dp(8), 0, dp(2))
            })
            return
        }
        for ((index, job) in jobs.withIndex()) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(13), dp(14), dp(13))
                background = roundedPanel("#100E16", "#2D2638", 16f)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    if (index > 0) topMargin = dp(9)
                }
            }
            val header = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val title = job.title ?: "YouTube · ${job.videoId}"
            header.addView(TextView(this).apply {
                text = title
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                setTextColor(Color.WHITE)
                textSize = 15f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            header.addView(statusBadge(job.status))
            row.addView(header)
            row.addView(TextView(this).apply {
                text = "${job.difficulty.uppercase()} · seed ${job.seed}"
                setTextColor(Color.parseColor("#A99CB8"))
                textSize = 11f
                setPadding(0, dp(7), 0, 0)
            })
            row.addView(TextView(this).apply {
                text = job.message
                setTextColor(Color.parseColor("#C6BFCE"))
                textSize = 12f
                setPadding(0, dp(5), 0, 0)
            })
            val actions = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.END
                setPadding(0, dp(8), 0, 0)
            }
            when (job.status) {
                ChartJobStore.COMPLETED -> job.songId?.let { songId ->
                    actions.addView(queueActionButton("플레이", primary = true) { openSong(songId) })
                }
                ChartJobStore.FAILED, ChartJobStore.NEEDS_RETRY, ChartJobStore.CANCELED -> actions.addView(
                    queueActionButton("재시도", primary = true) { ChartJobService.retry(this@MainActivity, job.id); refreshJobs() }
                )
                else -> actions.addView(
                    queueActionButton("취소", primary = false) { ChartJobService.cancel(this@MainActivity, job.id); refreshJobs() }
                )
            }
            if (actions.childCount > 0) row.addView(actions)
            jobQueue.addView(row)
        }
        allJobs.firstOrNull { it.status == ChartJobStore.COMPLETED && it.songId != null }?.songId?.let { lastSongId = it }
        refreshSongs()
    }

    private fun jobStatusLabel(status: String) = when (status) {
        ChartJobStore.QUEUED -> "대기"
        ChartJobStore.PREVIEWING -> "영상 확인"
        ChartJobStore.PREPARING -> "영상·음원 준비"
        ChartJobStore.ANALYZING -> "업로드·분석"
        ChartJobStore.SAVING -> "저장"
        ChartJobStore.COMPLETED -> "완료"
        ChartJobStore.FAILED -> "실패"
        ChartJobStore.CANCELED -> "취소"
        ChartJobStore.NEEDS_RETRY -> "확인 필요"
        else -> status
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
        batchAddButton.isEnabled = true
        batchUrlInput.isEnabled = true
    }

    private fun openSong(id: String) {
        startActivity(Intent(this, PlayActivity::class.java).putExtra(PlayActivity.EXTRA_SONG_ID, id))
    }

    private fun refreshSongs() {
        savedSongs.removeAllViews()
        val songs = store.list()
        if (songs.isEmpty()) {
            savedSongs.addView(TextView(this).apply {
                text = "아직 저장한 곡이 없어요. Queue에서 곡을 만들면 여기에 표시됩니다."
                setTextColor(Color.parseColor("#8D859A"))
                textSize = 13f
                setPadding(0, dp(8), 0, dp(2))
            })
        }
        for ((index, song) in songs.withIndex()) {
            val button = Button(this).apply {
                text = "${song.title}\n${song.difficulty.uppercase()}"
                isAllCaps = false
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setTextColor(Color.WHITE)
                textSize = 13f
                background = getDrawable(R.drawable.bg_button_secondary)
                setPadding(dp(14), dp(8), dp(14), dp(8))
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
            savedSongs.addView(button, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)).apply {
                if (index > 0) topMargin = dp(8)
            })
        }
    }

    private fun applyResponsiveContentWidth() {
        val displayWidth = resources.displayMetrics.widthPixels
        val target = minOf(displayWidth - dp(24), dp(700))
        val params = contentContainer.layoutParams as FrameLayout.LayoutParams
        params.width = target.coerceAtLeast(dp(280))
        params.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        contentContainer.layoutParams = params
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun roundedPanel(fill: String, stroke: String, radiusDp: Float) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(Color.parseColor(fill))
        cornerRadius = radiusDp * resources.displayMetrics.density
        setStroke(dp(1), Color.parseColor(stroke))
    }

    private fun statusBadge(status: String) = TextView(this).apply {
        text = jobStatusLabel(status).uppercase()
        textSize = 10f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        val (fill, textColor) = when (status) {
            ChartJobStore.COMPLETED -> "#18342A" to "#7EE2B8"
            ChartJobStore.FAILED -> "#3A1D28" to "#FF9DAF"
            ChartJobStore.CANCELED -> "#25212B" to "#AFA7BA"
            ChartJobStore.NEEDS_RETRY -> "#3A2D16" to "#FFD27A"
            ChartJobStore.QUEUED -> "#211B31" to "#BCAAF8"
            else -> "#291E40" to "#C7B1FF"
        }
        background = roundedPanel(fill, fill, 20f)
        setTextColor(Color.parseColor(textColor))
        setPadding(dp(9), dp(5), dp(9), dp(5))
    }

    private fun queueActionButton(label: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 12f
        setTextColor(Color.WHITE)
        background = getDrawable(if (primary) R.drawable.bg_button_primary else R.drawable.bg_button_ghost)
        setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(42)).apply { marginStart = dp(6) }
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
