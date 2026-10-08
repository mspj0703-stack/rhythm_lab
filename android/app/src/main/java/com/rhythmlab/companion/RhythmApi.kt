package com.rhythmlab.companion

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

object RhythmApi {
    val WEB_BASE: String = BuildConfig.BEATDASH_SERVICE_URL

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.MINUTES)
        .writeTimeout(8, TimeUnit.MINUTES)
        .callTimeout(10, TimeUnit.MINUTES)
        .build()

    data class Result(val analysis: JSONObject)

    fun analyze(file: File, difficulty: String, seed: Int): Result {
        val mediaType = "audio/wav".toMediaType()
        val multipart = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", file.name, file.asRequestBody(mediaType))
            .addFormDataPart("difficulty", difficulty.lowercase())
            .addFormDataPart("seed", seed.toString())
            .build()

        val request = Request.Builder()
            .url("$WEB_BASE/api/analyze")
            .post(multipart)
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val detail = runCatching { JSONObject(body).optString("detail") }.getOrNull()
                error(detail?.takeIf { it.isNotBlank() } ?: "서버 분석 실패 (${response.code})")
            }
            val json = JSONObject(body)
            return Result(json)
        }
    }
}
