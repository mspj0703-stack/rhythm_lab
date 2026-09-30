package com.rhythmlab.companion

import android.content.Context
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import org.json.JSONObject

object YoutubeEngine {
    data class ExtractedMedia(val audio: File, val video: File, val originalTitle: String?, val thumbnail: File?)
    private var initialized = false

    private data class YoutubeStrategy(
        val label: String,
        val extractorArgs: String?,
    )

    private val youtubeStrategies = listOf(
        YoutubeStrategy("Android", "youtube:player_client=android"),
        YoutubeStrategy("Web embedded", "youtube:player_client=default,web_embedded"),
        YoutubeStrategy("기본", null),
    )

    @Synchronized
    fun ensureInitialized(context: Context, status: (String) -> Unit) {
        if (initialized) return
        status("yt-dlp 엔진 초기화 중…")
        YoutubeDL.getInstance().init(context.applicationContext)
        FFmpeg.getInstance().init(context.applicationContext)
        initialized = true

        runCatching {
            status("yt-dlp 최신 버전 확인 중…")
            YoutubeDL.getInstance().updateYoutubeDL(
                context.applicationContext,
                YoutubeDL.UpdateChannel.NIGHTLY,
            )
        }
    }

    // One progressive A/V download, then derive WAV from that exact source.
    // --keep-video retains source.mp4 after ExtractAudio writes source.wav.
    private fun buildRequest(url: String, dir: File, extractorArgs: String?): YoutubeDLRequest =
        YoutubeDLRequest(url).apply {
            addOption("--no-playlist")
            addOption("--no-warnings")
            addOption("--match-filter", "duration <= 480 & !is_live")
            addOption("--max-filesize", "80M")
            if (extractorArgs != null) addOption("--extractor-args", extractorArgs)
            addOption("-f", "best[ext=mp4][height<=480][vcodec^=avc1][acodec^=mp4a]")
            addOption("--keep-video")
            addOption("-x")
            addOption("--audio-format", "wav")
            addOption("--postprocessor-args", "ExtractAudio+ffmpeg_o:-ac 1 -ar 22050 -c:a pcm_s16le")
            addOption("--no-mtime")
            addOption("--write-info-json")
            addOption("--write-thumbnail")
            addOption("--convert-thumbnails", "jpg")
            addOption("-o", File(dir, "source.%(ext)s").absolutePath)
        }

    @Synchronized
    fun extractMedia(context: Context, url: String, onProgress: (Int, String) -> Unit): ExtractedMedia {
        ensureInitialized(context) { onProgress(1, it) }
        val dir = File(context.cacheDir, "rhythm_media_extract")
        var lastError: Exception? = null
        for ((attemptIndex, strategy) in youtubeStrategies.withIndex()) {
            dir.mkdirs()
            dir.listFiles()?.forEach { it.deleteRecursively() }
            try {
                onProgress(0, "MV 준비 중 · ${strategy.label}")
                YoutubeDL.getInstance().execute(buildRequest(url, dir, strategy.extractorArgs),
                    "beatdash-${System.currentTimeMillis()}-$attemptIndex") { progress, _, line ->
                    onProgress(progress.toInt().coerceIn(0, 95),
                        if (line.contains("ExtractAudio")) "같은 영상에서 분석 음원 추출 중…" else "MV 다운로드 중…")
                }
                val video = File(dir, "source.mp4")
                val audio = File(dir, "source.wav")
                check(video.isFile && video.length() in 1..(80L * 1024 * 1024)) { "완성된 MP4를 찾지 못했습니다." }
                check(audio.isFile && audio.length() > 44) { "분석용 WAV 추출 실패" }
                val info = File(dir, "source.info.json").takeIf { it.isFile }
                val infoJson = runCatching { info?.let { JSONObject(it.readText()) } }.getOrNull()
                val title = infoJson?.optString("title")?.trim()?.takeIf(String::isNotBlank)
                // yt-dlp/thumbnail postprocessors may leave jpg/jpeg with a suffix depending on version.
                // Accept the converted image instead of requiring the exact name source.jpg.
                val thumbnail = dir.walkTopDown().firstOrNull { file ->
                    file.isFile && file.extension.lowercase() in setOf("jpg", "jpeg") &&
                        !file.name.endsWith(".info.json", ignoreCase = true)
                }
                onProgress(100, "영상·음원 준비 완료")
                return ExtractedMedia(audio, video, title, thumbnail)
            } catch (e: Exception) { lastError = e }
        }
        dir.deleteRecursively()
        error("호환되는 MP4 영상을 가져오지 못했습니다. 다른 영상을 사용하거나 다시 시도해 주세요. (${lastError?.message.orEmpty().take(160)})")
    }
}
