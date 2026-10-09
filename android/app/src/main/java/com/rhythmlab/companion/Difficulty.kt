package com.rhythmlab.companion

/**
 * v5 Phase 2: user-facing difficulty names. The value sent to the server and stored in jobs/songs keeps
 * the Phase 1 identifiers; `extreme` is shown as MASTER.
 */
object Difficulty {
    data class Option(val value: String, val label: String) {
        // ArrayAdapter renders toString(): the spinner shows MASTER while the job stores "extreme".
        override fun toString(): String = label
    }

    val OPTIONS = listOf(
        Option("easy", "EASY"),
        Option("normal", "NORMAL"),
        Option("hard", "HARD"),
        Option("expert", "EXPERT"),
        Option("extreme", "MASTER"),
    )

    fun normalize(value: String?): String {
        val key = value.orEmpty().trim().lowercase()
        return if (key == "master") "extreme" else key
    }

    fun label(value: String?): String {
        val key = normalize(value)
        return OPTIONS.firstOrNull { it.value == key }?.label ?: value.orEmpty().uppercase()
    }
}
