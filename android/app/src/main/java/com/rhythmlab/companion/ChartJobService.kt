package com.rhythmlab.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Serial foreground worker for chart jobs. Heavy download/analysis concurrency stays at exactly one. */
class ChartJobService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val loopRunning = AtomicBoolean(false)
    private lateinit var jobs: ChartJobStore
    private lateinit var songs: SavedSongStore
    @Volatile private var currentJobId: String? = null

    override fun onCreate() {
        super.onCreate()
        jobs = ChartJobStore(this)
        songs = SavedSongStore(this)
        jobs.recoverInterrupted()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CANCEL -> intent.getStringExtra(EXTRA_JOB_ID)?.let(jobs::requestCancel)
            ACTION_RETRY -> intent.getStringExtra(EXTRA_JOB_ID)?.let(jobs::retry)
        }
        startForeground(NOTIFICATION_ID, notification("작업 대기열 확인 중", jobs.list()))
        runQueue()
        return START_NOT_STICKY
    }

    private fun runQueue() {
        if (!loopRunning.compareAndSet(false, true)) return
        executor.execute {
            try {
                while (true) {
                    val job = jobs.nextRunnable() ?: break
                    currentJobId = job.id
                    process(job)
                }
            } finally {
                currentJobId = null
                loopRunning.set(false)
                val pending = jobs.nextRunnable()
                if (pending != null) runQueue() else {
                    updateNotification("대기 중인 작업이 없습니다.")
                    stopForeground(STOP_FOREGROUND_DETACH)
                    stopSelf()
                }
            }
        }
    }

    private fun process(job: ChartJobStore.Job) {
        var workDir: java.io.File? = null
        try {
            if (isCanceled(job.id)) return markCanceled(job.id)
            jobs.setStatus(job.id, ChartJobStore.PREVIEWING, "영상 정보 확인 중")
            updateNotification("영상 정보 확인 중")
            val preview = YoutubeEngine.preview(this, job.url)
            jobs.setStatus(job.id, ChartJobStore.PREPARING, "영상·음원 준비 중", preview.title)
            updateNotification("${preview.title} · 영상 준비 중")
            if (isCanceled(job.id)) return markCanceled(job.id)

            val media = YoutubeEngine.extractMedia(this, job.url, job.id) { _, message ->
                jobs.setStatus(job.id, ChartJobStore.PREPARING, message, preview.title)
                updateNotification("${preview.title} · $message")
            }
            workDir = media.audio.parentFile
            if (isCanceled(job.id)) return markCanceled(job.id)

            jobs.setStatus(job.id, ChartJobStore.ANALYZING, "업로드·분석·채보 생성 중", preview.title)
            updateNotification("${preview.title} · 분석 중")
            val result = RhythmApi.analyze(media.audio, job.difficulty, job.seed)
            if (isCanceled(job.id)) return markCanceled(job.id)

            jobs.setStatus(job.id, ChartJobStore.SAVING, "기기에 저장 중", preview.title)
            val song = songs.save(result.analysis, media.audio, media.video, job.videoId, media.originalTitle ?: preview.title, media.thumbnail)
            jobs.setStatus(job.id, ChartJobStore.COMPLETED, "완료", preview.title, song.id)
            updateNotification("${preview.title} · 완료")
        } catch (e: Exception) {
            if (isCanceled(job.id)) markCanceled(job.id)
            else jobs.setStatus(job.id, ChartJobStore.FAILED, friendlyError(e))
            updateNotification("작업 실패 · 앱에서 확인")
        } finally {
            workDir?.takeIf { it.name.startsWith("rhythm_media_extract-") }?.deleteRecursively()
        }
    }

    private fun isCanceled(id: String) = jobs.list().firstOrNull { it.id == id }?.cancelRequested == true
    private fun markCanceled(id: String) { jobs.setStatus(id, ChartJobStore.CANCELED, "취소됨") }
    private fun friendlyError(e: Exception): String = e.message?.take(180)?.takeIf { it.isNotBlank() } ?: "작업을 완료하지 못했습니다. 연결 상태를 확인해 주세요."

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, notification(text, jobs.list()))
    }

    private fun notification(text: String, list: List<ChartJobStore.Job>): Notification {
        val completed = list.count { it.status == ChartJobStore.COMPLETED }
        val active = list.count { it.status !in ChartJobStore.TERMINAL && it.status != ChartJobStore.NEEDS_RETRY }
        val openIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("BEATDASH 채보 생성")
            .setContentText("$text · 완료 $completed · 대기/진행 $active")
            .setContentIntent(openIntent)
            .setOngoing(active > 0)
            .setOnlyAlertOnce(true)
        currentJobId?.let { id ->
            val cancelIntent = Intent(this, ChartJobService::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_JOB_ID, id)
            val cancelPending = PendingIntent.getService(this, id.hashCode(), cancelIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "현재 작업 취소", cancelPending)
        }
        return builder.build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL_ID, "채보 생성", NotificationManager.IMPORTANCE_LOW).apply {
                description = "백그라운드 채보 생성 진행 상태"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    // Android 15 dataSync foreground-service timeout callback.
    override fun onTimeout(startId: Int, fgsType: Int) {
        currentJobId?.let { id -> jobs.setStatus(id, ChartJobStore.NEEDS_RETRY, "Android 백그라운드 실행 시간 제한으로 중단되었습니다. 다시 시도해 주세요.") }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "beatdash_chart_jobs"
        private const val NOTIFICATION_ID = 4752
        const val ACTION_RUN = "com.rhythmlab.companion.RUN_CHART_QUEUE"
        const val ACTION_CANCEL = "com.rhythmlab.companion.CANCEL_CHART_JOB"
        const val ACTION_RETRY = "com.rhythmlab.companion.RETRY_CHART_JOB"
        const val EXTRA_JOB_ID = "job_id"

        fun start(context: Context) {
            val intent = Intent(context, ChartJobService::class.java).setAction(ACTION_RUN)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }

        fun cancel(context: Context, id: String) {
            val intent = Intent(context, ChartJobService::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_JOB_ID, id)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }

        fun retry(context: Context, id: String) {
            val intent = Intent(context, ChartJobService::class.java).setAction(ACTION_RETRY).putExtra(EXTRA_JOB_ID, id)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }
    }
}
