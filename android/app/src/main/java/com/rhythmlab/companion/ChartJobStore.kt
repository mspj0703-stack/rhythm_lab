package com.rhythmlab.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

/** Persistent, single-writer-friendly queue state for background chart generation. */
class ChartJobStore(context: Context) {
    private val file = File(context.filesDir, "chart_jobs.json")
    private val lock = Any()

    data class Job(
        val id: String,
        val url: String,
        val difficulty: String,
        val seed: Int,
        val videoId: String,
        val status: String,
        val title: String?,
        val message: String,
        val createdAt: Long,
        val updatedAt: Long,
        val retryCount: Int,
        val cancelRequested: Boolean,
        val songId: String?,
    )

    fun enqueue(url: String, difficulty: String, seed: Int, videoId: String): Job = synchronized(lock) {
        val jobs = readUnsafe().toMutableList()
        val duplicate = jobs.firstOrNull {
            it.videoId == videoId && it.difficulty == difficulty && it.seed == seed && it.status !in TERMINAL
        }
        if (duplicate != null) return@synchronized duplicate
        val now = System.currentTimeMillis()
        val job = Job(UUID.randomUUID().toString(), url, difficulty, seed, videoId, QUEUED, null, "대기 중", now, now, 0, false, null)
        jobs += job
        writeUnsafe(jobs)
        job
    }

    fun list(): List<Job> = synchronized(lock) { readUnsafe().sortedBy { it.createdAt } }

    fun nextRunnable(): Job? = synchronized(lock) {
        readUnsafe().firstOrNull { it.status == QUEUED && !it.cancelRequested }
    }

    fun update(id: String, transform: (Job) -> Job): Job? = synchronized(lock) {
        val jobs = readUnsafe().toMutableList()
        val index = jobs.indexOfFirst { it.id == id }
        if (index < 0) return@synchronized null
        val changed = transform(jobs[index]).copy(updatedAt = System.currentTimeMillis())
        jobs[index] = changed
        writeUnsafe(jobs)
        changed
    }

    fun setStatus(id: String, status: String, message: String, title: String? = null, songId: String? = null): Job? =
        update(id) { current -> current.copy(status = status, message = message, title = title ?: current.title, songId = songId ?: current.songId) }

    fun requestCancel(id: String): Job? = update(id) { current ->
        if (current.status in TERMINAL) current else current.copy(cancelRequested = true, status = if (current.status == QUEUED) CANCELED else current.status, message = "취소 요청됨")
    }

    fun retry(id: String): Job? = update(id) { current ->
        if (current.status !in setOf(FAILED, NEEDS_RETRY, CANCELED)) current
        else current.copy(status = QUEUED, message = "재시도 대기 중", retryCount = current.retryCount + 1, cancelRequested = false, songId = null)
    }

    /**
     * Called when a new service instance starts after process/service death.
     * Local download/preparation may safely restart. An interrupted server analysis is deliberately NOT
     * auto-resubmitted because the previous request may already have been accepted by the server.
     */
    fun recoverInterrupted(): Boolean = synchronized(lock) {
        var changed = false
        val recovered = readUnsafe().map { job ->
            when (job.status) {
                PREVIEWING, PREPARING -> { changed = true; job.copy(status = QUEUED, message = "작업 복구 대기 중", updatedAt = System.currentTimeMillis()) }
                ANALYZING, SAVING -> { changed = true; job.copy(status = NEEDS_RETRY, message = "이전 분석이 중단되었습니다. 중복 방지를 위해 수동 재시도가 필요합니다.", updatedAt = System.currentTimeMillis()) }
                else -> job
            }
        }
        if (changed) writeUnsafe(recovered)
        changed
    }

    fun purgeFinished(olderThanMs: Long = 7L * 24 * 60 * 60 * 1000) = synchronized(lock) {
        val cutoff = System.currentTimeMillis() - olderThanMs
        val jobs = readUnsafe().filterNot { it.status in TERMINAL && it.updatedAt < cutoff }
        writeUnsafe(jobs)
    }

    private fun readUnsafe(): List<Job> {
        if (!file.isFile) return emptyList()
        return runCatching {
            val array = JSONArray(file.readText())
            buildList {
                for (i in 0 until array.length()) add(fromJson(array.getJSONObject(i)))
            }
        }.getOrElse { emptyList() }
    }

    private fun writeUnsafe(jobs: List<Job>) {
        val array = JSONArray()
        jobs.forEach { array.put(toJson(it)) }
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.writeText(array.toString())
        runCatching {
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }.getOrElse {
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }

    private fun toJson(job: Job) = JSONObject()
        .put("id", job.id).put("url", job.url).put("difficulty", job.difficulty).put("seed", job.seed)
        .put("videoId", job.videoId).put("status", job.status).put("title", job.title ?: JSONObject.NULL)
        .put("message", job.message).put("createdAt", job.createdAt).put("updatedAt", job.updatedAt)
        .put("retryCount", job.retryCount).put("cancelRequested", job.cancelRequested)
        .put("songId", job.songId ?: JSONObject.NULL)

    private fun fromJson(json: JSONObject) = Job(
        json.getString("id"), json.getString("url"), json.getString("difficulty"), json.optInt("seed", 42),
        json.getString("videoId"), json.optString("status", QUEUED), json.optString("title").takeIf { it.isNotBlank() && it != "null" },
        json.optString("message", "대기 중"), json.optLong("createdAt", 0), json.optLong("updatedAt", 0),
        json.optInt("retryCount", 0), json.optBoolean("cancelRequested", false), json.optString("songId").takeIf { it.isNotBlank() && it != "null" },
    )

    companion object {
        const val QUEUED = "queued"
        const val PREVIEWING = "previewing"
        const val PREPARING = "preparing"
        const val ANALYZING = "analyzing"
        const val SAVING = "saving"
        const val COMPLETED = "completed"
        const val FAILED = "failed"
        const val CANCELED = "canceled"
        const val NEEDS_RETRY = "needs_retry"
        val TERMINAL = setOf(COMPLETED, FAILED, CANCELED)
    }
}
