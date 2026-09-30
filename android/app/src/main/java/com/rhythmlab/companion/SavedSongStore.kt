package com.rhythmlab.companion

import android.content.Context
import org.json.JSONObject
import java.io.File

/** Keeps the analyzed chart and its small PCM WAV together beyond the server session TTL. */
class SavedSongStore(context: Context) {
    private val root = File(context.filesDir, "songs").apply { mkdirs() }

    data class Song(val id: String, val title: String, val difficulty: String, val videoId: String, val savedAt: Long)

    private fun directory(id: String): File {
        require(id.matches(Regex("[a-f0-9]{32}"))) { "Invalid analysis ID" }
        return File(root, id)
    }

    fun save(analysis: JSONObject, audio: File, video: File, videoId: String, originalTitle: String? = null, thumbnail: File? = null): Song {
        val id = analysis.getString("id")
        val target = directory(id).apply { mkdirs() }
        val song = Song(
            id,
            originalTitle?.trim()?.takeIf { it.isNotBlank() }
                ?: analysis.optJSONObject("chart")?.optString("title")?.takeIf { it.isNotBlank() }
                ?: analysis.optString("originalName", "Untitled"),
            analysis.optJSONObject("report")?.optString("difficulty", "hard") ?: "hard",
            videoId,
            System.currentTimeMillis(),
        )
        val metadata = JSONObject()
            .put("id", id).put("title", song.title).put("difficulty", song.difficulty)
            .put("videoId", videoId).put("savedAt", song.savedAt)
        try {
            // Write into the same directory so a failed save never appears as a playable song.
            val tempAudio = File(target, "audio.tmp")
            audio.copyTo(tempAudio, overwrite = true)
            check(tempAudio.renameTo(File(target, "audio.wav"))) { "오디오 저장 실패" }
            val tempVideo = File(target, "video.tmp")
            video.copyTo(tempVideo, overwrite = true)
            check(tempVideo.renameTo(File(target, "video.mp4"))) { "MV 저장 실패" }
            if (thumbnail?.isFile == true) thumbnail.copyTo(File(target, "thumbnail.jpg"), overwrite = true)
            val localAnalysis = JSONObject(analysis.toString())
                .put("mediaKind", "video").put("mediaUrl", "/api/video/$id")
                .put("originalTitle", song.title)
                .put("originalThumbnailUrl", if (File(target, "thumbnail.jpg").isFile) "/api/thumbnail/$id" else JSONObject.NULL)
            localAnalysis.optJSONObject("chart")?.put("title", song.title)
            File(target, "analysis.tmp").writeText(localAnalysis.toString())
            check(File(target, "analysis.tmp").renameTo(File(target, "analysis.json"))) { "채보 저장 실패" }
            File(target, "song.tmp").writeText(metadata.toString())
            check(File(target, "song.tmp").renameTo(File(target, "song.json"))) { "곡 목록 저장 실패" }
        } catch (e: Exception) {
            target.deleteRecursively()
            throw e
        }
        return song
    }

    fun list(): List<Song> = root.listFiles().orEmpty().mapNotNull { dir ->
        runCatching {
            val json = JSONObject(File(dir, "song.json").readText())
            val id = json.getString("id")
            if (directory(id) != dir || !File(dir, "analysis.json").isFile || !File(dir, "audio.wav").isFile) return@runCatching null
            val analysis = JSONObject(File(dir, "analysis.json").readText())
            if (analysis.optString("mediaKind") == "video" && !File(dir, "video.mp4").isFile) return@runCatching null
            Song(id, json.getString("title"), json.optString("difficulty", "hard"), json.getString("videoId"), json.getLong("savedAt"))
        }.getOrNull()
    }.sortedByDescending { it.savedAt }

    fun session(id: String): File = File(directory(id), "analysis.json")
    fun audio(id: String): File = File(directory(id), "audio.wav")
    fun video(id: String): File = File(directory(id), "video.mp4")
    fun thumbnail(id: String): File = File(directory(id), "thumbnail.jpg")
    fun delete(id: String) { directory(id).deleteRecursively() }
}
