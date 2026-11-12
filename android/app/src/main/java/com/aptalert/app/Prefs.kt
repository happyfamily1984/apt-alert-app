package com.aptalert.app

import org.json.JSONObject
import java.time.LocalTime

/** 사용자 설정(알림 방법·화면 디자인). Android 의존성 없음 → 단위 테스트 가능 */
object Prefs {
    /** 강조 색상: 이름 → (밝은 테마 색, 어두운 테마 색) */
    val ACCENTS = linkedMapOf(
        "blue" to ("#2563EB" to "#5B8CFF"),
        "green" to ("#059669" to "#34D399"),
        "teal" to ("#0D9488" to "#2DD4BF"),
        "purple" to ("#7C3AED" to "#A78BFA"),
        "pink" to ("#DB2777" to "#F472B6"),
        "red" to ("#DC2626" to "#F87171"),
        "orange" to ("#EA580C" to "#FB923C"),
        "navy" to ("#1E3A8A" to "#93A5F5"),
    )

    /** 진동 패턴 (대기, 진동, 대기, 진동 …) ms */
    val PATTERNS = linkedMapOf(
        "short" to longArrayOf(0, 200),
        "long" to longArrayOf(0, 700),
        "double" to longArrayOf(0, 200, 150, 200),
        "triple" to longArrayOf(0, 150, 100, 150, 100, 150),
    )

    private val THEMES = setOf("system", "light", "dark")
    val ICONS = listOf("house", "building", "bell", "chart")
    private val FONT_SCALES = setOf(85, 100, 115, 130)
    private val TIME = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

    fun defaults(): JSONObject = JSONObject()
        .put("notiSound", true).put("soundUri", "").put("soundName", "기본 알림음")
        .put("notiVibrate", true).put("vibratePattern", "short")
        .put("notiPopup", true).put("notiCanceled", true)
        .put("quietEnabled", false).put("quietStart", "22:00").put("quietEnd", "08:00")
        .put("theme", "system").put("accent", "blue").put("fontScale", 100)
        // 알림 디자인
        .put("notiColor", "app").put("notiIcon", "house").put("notiTitle", "count")
        .put("notiDetail", "detail").put("notiLockscreen", "show")

    /** 저장된 설정 + 기본값 */
    fun get(settings: JSONObject): JSONObject {
        val p = defaults()
        val saved = settings.optJSONObject("prefs") ?: return p
        for (k in saved.keys()) if (p.has(k)) p.put(k, saved.get(k))
        return p
    }

    /** 들어온 값 검증 후 저장 설정에 합침. 잘못된 값은 무시 */
    fun merge(settings: JSONObject, input: JSONObject): JSONObject {
        val saved = settings.optJSONObject("prefs") ?: JSONObject().also { settings.put("prefs", it) }
        for (k in input.keys()) {
            val v = input.get(k)
            val ok = when (k) {
                "notiSound", "notiVibrate", "notiPopup", "notiCanceled", "quietEnabled" -> v is Boolean
                "soundUri" -> v is String && (v.isEmpty() || v.startsWith("content://") || v.startsWith("android.resource://"))
                "soundName" -> v is String && v.length <= 80
                "vibratePattern" -> v in PATTERNS
                "quietStart", "quietEnd" -> v is String && TIME.matches(v)
                "theme" -> v in THEMES
                "accent" -> v in ACCENTS
                "fontScale" -> (v as? Number)?.toInt() in FONT_SCALES
                "notiColor" -> v == "app" || v in ACCENTS
                "notiIcon" -> v in ICONS
                "notiTitle" -> v == "count" || v == "price"
                "notiDetail" -> v == "simple" || v == "detail"
                "notiLockscreen" -> v == "show" || v == "hide"
                else -> false
            }
            if (ok) saved.put(k, if (k == "fontScale") (v as Number).toInt() else v)
        }
        return get(settings)
    }

    /** 조용한 시간인지 (자정을 넘는 구간도 지원: 22:00~08:00) */
    fun isQuiet(p: JSONObject, now: LocalTime): Boolean {
        if (!p.optBoolean("quietEnabled")) return false
        val s = runCatching { LocalTime.parse(p.optString("quietStart")) }.getOrNull() ?: return false
        val e = runCatching { LocalTime.parse(p.optString("quietEnd")) }.getOrNull() ?: return false
        if (s == e) return false
        return if (s < e) !now.isBefore(s) && now.isBefore(e) else !now.isBefore(s) || now.isBefore(e)
    }

    /** 알림 색: '앱 색상 따라가기'면 강조 색상 */
    fun notiColor(p: JSONObject): String {
        val k = p.optString("notiColor", "app")
        return (ACCENTS[if (k == "app") p.optString("accent") else k] ?: ACCENTS.getValue("blue")).first
    }

    fun accentColor(p: JSONObject, dark: Boolean): String =
        (ACCENTS[p.optString("accent")] ?: ACCENTS.getValue("blue")).let { if (dark) it.second else it.first }
}
