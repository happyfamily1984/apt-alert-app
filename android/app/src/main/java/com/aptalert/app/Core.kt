package com.aptalert.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.Collator
import java.time.Instant
import java.util.Locale
import java.util.UUID
import kotlin.math.roundToLong

// ---------------------------------------------------------------------------
// 저장소: filesDir/db.json (구독, 알림함, 본 거래 기록, 설정)
// ---------------------------------------------------------------------------
class Store(private val file: File?) {
    val data: JSONObject = load()

    private fun load(): JSONObject {
        val o = file?.takeIf { it.exists() }?.let { runCatching { JSONObject(it.readText()) }.getOrNull() } ?: JSONObject()
        if (!o.has("subscriptions")) o.put("subscriptions", JSONArray())
        if (!o.has("notifications")) o.put("notifications", JSONArray())
        if (!o.has("seen")) o.put("seen", JSONObject())
        if (!o.has("settings")) o.put("settings", JSONObject())
        return o
    }

    val subscriptions: JSONArray get() = data.getJSONArray("subscriptions")
    val notifications: JSONArray get() = data.getJSONArray("notifications")
    val seen: JSONObject get() = data.getJSONObject("seen")
    val settings: JSONObject get() = data.getJSONObject("settings")

    @Synchronized
    fun save() {
        val f = file ?: return
        f.parentFile?.mkdirs()
        val tmp = File(f.path + ".tmp")
        tmp.writeText(data.toString())
        if (!tmp.renameTo(f)) { f.writeText(data.toString()); tmp.delete() }
    }
}

fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

// ---------------------------------------------------------------------------
// 시군구
// ---------------------------------------------------------------------------
class Regions(json: String) {
    val raw = JSONArray(json)
    private val byCode = HashMap<String, JSONObject>()

    init {
        for (r in raw.objects()) {
            val sido = r.getString("sido")
            for (s in r.getJSONArray("sigungu").objects()) {
                byCode[s.getString("code")] = JSONObject()
                    .put("code", s.getString("code")).put("name", s.getString("name"))
                    .put("sido", sido).put("fullName", "$sido ${s.getString("name")}")
            }
        }
    }

    fun get(code: String?): JSONObject? = code?.let { byCode[it] }
}

// ---------------------------------------------------------------------------
// 포맷 (알림 문구)
// ---------------------------------------------------------------------------
object Fmt {
    private fun comma(n: Long) = "%,d".format(n)
    fun manwon(v: Long): String {
        val eok = v / 10000
        val rest = v % 10000
        return when {
            eok > 0 && rest > 0 -> "${eok}억 ${comma(rest)}만"
            eok > 0 -> "${eok}억"
            else -> "${comma(rest)}만"
        }
    }

    fun price(d: Deal) = when (d.type) {
        "trade" -> manwon(d.price)
        "jeonse" -> manwon(d.deposit)
        else -> "${manwon(d.deposit)} / 월 ${comma(d.monthlyRent)}만"
    }

    /** 84.9329 → "84.93" (국토부 원자료는 소수 넷째 자리까지 옴) */
    fun area(a: Double): String = java.math.BigDecimal(a).setScale(2, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()

    fun line(d: Deal): String {
        val md = d.date.substring(5).replace('-', '/')
        return "[${Molit.TYPES[d.type]}] ${area(d.area)}㎡ ${d.floor}층 · ${price(d)} · $md${if (d.canceled) " (해제)" else ""}"
    }
}

// ---------------------------------------------------------------------------
// 단지 목록 / 거래 조회
// ---------------------------------------------------------------------------
class Service(private val molit: MolitClient, val complexMonths: Int = 6) {
    private val collator = Collator.getInstance(Locale.KOREAN)

    fun getComplexes(lawdCd: String): List<JSONObject> {
        val all = molit.fetchMonths("trade", lawdCd, complexMonths) + molit.fetchMonths("rent", lawdCd, complexMonths)
        val map = LinkedHashMap<String, JSONObject>()
        for (d in all) {
            val c = map.getOrPut(d.complexId) {
                JSONObject().put("id", d.complexId).put("lawdCd", lawdCd).put("aptNm", d.aptNm).put("umdNm", d.umdNm)
                    .put("jibun", d.jibun).put("buildYear", d.buildYear ?: JSONObject.NULL)
                    .put("counts", JSONObject().put("trade", 0).put("jeonse", 0).put("monthly", 0))
                    .put("lastDealDate", JSONObject.NULL).put("lastTradePrice", JSONObject.NULL).put("lastTradeDate", JSONObject.NULL)
            }
            if (c.isNull("buildYear") && d.buildYear != null) c.put("buildYear", d.buildYear)
            if (d.canceled) continue
            val counts = c.getJSONObject("counts")
            counts.put(d.type, counts.getInt(d.type) + 1)
            if (c.isNull("lastDealDate") || d.date > c.getString("lastDealDate")) c.put("lastDealDate", d.date)
            if (d.type == "trade" && (c.isNull("lastTradeDate") || d.date > c.getString("lastTradeDate"))) {
                c.put("lastTradeDate", d.date).put("lastTradePrice", d.price)
            }
        }
        return map.values.sortedWith { a, b -> collator.compare(a.getString("aptNm"), b.getString("aptNm")) }
    }

    fun getComplex(lawdCd: String, id: String) = getComplexes(lawdCd).firstOrNull { it.getString("id") == id }

    fun getDeals(lawdCd: String, complexId: String, type: String, months: Int = complexMonths, force: Boolean = false): List<Deal> {
        val api = Molit.apiForType(type)
        val all = if (force) Molit.recentYms(months, molit.today()).flatMap { molit.fetchMonth(api, lawdCd, it, true) }
        else molit.fetchMonths(api, lawdCd, months)
        return all.filter { it.complexId == complexId && it.type == type }
            .sortedWith(compareByDescending<Deal> { it.date }.thenByDescending { it.floor })
    }

    companion object {
        fun summarize(deals: List<Deal>): JSONObject {
            val valid = deals.filter { !it.canceled }
            if (valid.isEmpty()) return JSONObject().put("count", 0)
            val v = valid.map { if (it.type == "trade") it.price else it.deposit }
            val perPy = valid.map { (if (it.type == "trade") it.price else it.deposit) / (it.area / 3.3058) }
            return JSONObject().put("count", valid.size).put("avg", v.average().roundToLong())
                .put("min", v.min()).put("max", v.max()).put("avgPerPyeong", perPy.average().roundToLong())
        }
    }
}

// ---------------------------------------------------------------------------
// 알림 구독 / 신규·해제 거래 감지
// ---------------------------------------------------------------------------
fun interface Notifier {
    /** @return 실제로 알림을 표시했으면 true */
    fun show(id: Int, title: String, body: String, hash: String): Boolean
}

class Alerts(
    private val store: Store,
    private val molit: MolitClient,
    private val service: Service,
    private val notifier: Notifier,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val POLL_MONTHS = 2 // 신고기한 30일 → 이번 달 + 지난달만 계속 바뀜
        const val MAX_NOTIFICATIONS = 300
    }

    private fun nowIso() = Instant.ofEpochMilli(clock()).toString()

    /** 최신 계약일 순으로 정렬된 거래 목록 → 알림 본문 */
    private fun sorted(deals: List<Deal>) = deals.sortedWith(compareByDescending<Deal> { it.date }.thenByDescending { it.floor })

    private fun body(deals: List<Deal>): String {
        val s = sorted(deals)
        val lines = s.take(5).map(Fmt::line).toMutableList()
        if (s.size > 5) lines.add("외 ${s.size - 5}건")
        return lines.joinToString("\n")
    }

    /** "매매 2 · 전세 1" */
    private fun typeSummary(deals: List<Deal>) =
        Molit.TYPES.entries.mapNotNull { (t, l) -> deals.count { it.type == t }.takeIf { it > 0 }?.let { "$l $it" } }.joinToString(" · ")

    private fun notify(sub: JSONObject, title: String, body: String, kind: String, deals: List<Deal> = emptyList(), type: String = sub.getString("type")) {
        val n = JSONObject().put("id", UUID.randomUUID().toString()).put("subscriptionId", sub.getString("id"))
            .put("lawdCd", sub.getString("lawdCd")).put("complexId", sub.getString("complexId")).put("type", type)
            .put("aptNm", sub.optString("aptNm")).put("umdNm", sub.optString("umdNm"))
            .put("kind", kind).put("title", title).put("body", body).put("createdAt", nowIso()).put("read", false)
            .put("deals", JSONArray(sorted(deals).take(30).map { it.toJson() }))
        val list = store.notifications
        list.put(n)
        while (list.length() > MAX_NOTIFICATIONS) list.remove(0)
        store.save()
        // 알림을 누르면 그 단지 상세 화면에서 해당 거래로 이동 (NEW 표시)
        val hash = "#/complex/${sub.getString("lawdCd")}/${sub.getString("complexId")}?type=$type&n=${n.getString("id")}"
        // 같은 단지는 휴대폰 알림도 하나로 (새 알림이 이전 알림을 대체)
        notifier.show("${sub.getString("lawdCd")}:${sub.getString("complexId")}".hashCode(), title, body, hash)
    }

    private fun seenFor(api: String, lawdCd: String): JSONObject? = store.seen.optJSONObject("$api:$lawdCd")

    private fun ensureBaseline(api: String, lawdCd: String) {
        if (seenFor(api, lawdCd) != null) return
        val months = JSONObject()
        for (ym in Molit.recentYms(POLL_MONTHS, molit.today())) {
            val m = JSONObject()
            for (d in molit.fetchMonth(api, lawdCd, ym)) m.put(d.key, if (d.canceled) "canceled" else "1")
            months.put(ym, m)
        }
        store.seen.put("$api:$lawdCd", JSONObject().put("initializedAt", nowIso()).put("months", months))
        store.save()
    }

    @Synchronized
    fun subscribe(lawdCd: String, complexId: String, type: String): Pair<JSONObject, Int> {
        if (type !in Molit.TYPES) throw ApiError(400, "type은 trade|jeonse|monthly 중 하나여야 합니다")
        store.subscriptions.objects().firstOrNull {
            it.getString("lawdCd") == lawdCd && it.getString("complexId") == complexId && it.getString("type") == type
        }?.let { return it to 0 }

        val complex = service.getComplex(lawdCd, complexId) ?: throw ApiError(404, "단지를 찾을 수 없습니다")
        val sub = JSONObject().put("id", UUID.randomUUID().toString()).put("lawdCd", lawdCd).put("complexId", complexId)
            .put("aptNm", complex.getString("aptNm")).put("umdNm", complex.getString("umdNm")).put("type", type)
            .put("createdAt", nowIso())
        val api = Molit.apiForType(type)
        ensureBaseline(api, lawdCd)

        val since = molit.today().minusDays(30).toString()
        val recent = service.getDeals(lawdCd, complexId, type, POLL_MONTHS).filter { it.date >= since }
        // 직전 확인 이후 신고돼 '최근 한 달'로 이미 보낸 거래는 다음 확인 때 중복 알림하지 않음
        val months = seenFor(api, lawdCd)!!.getJSONObject("months")
        val skip = recent.filter { d -> months.optJSONObject(d.date.substring(0, 7).replace("-", ""))?.has(d.key) != true }.map { it.key }
        sub.put("skipKeys", JSONArray(skip))
        store.subscriptions.put(sub)
        store.save()

        val label = "${complex.getString("aptNm")} ${Molit.TYPES[type]}"
        notify(
            sub, "🔔 $label 알림 시작",
            if (recent.isNotEmpty()) "최근 한 달 실거래 ${recent.size}건\n${body(recent)}" else "최근 한 달간 신고된 실거래가 없습니다. 새 거래가 신고되면 알려드릴게요.",
            "recent",
            recent,
        )
        return sub to recent.size
    }

    @Synchronized
    fun unsubscribe(id: String): Boolean {
        val list = store.subscriptions
        for (i in 0 until list.length()) {
            if (list.getJSONObject(i).getString("id") == id) {
                list.remove(i)
                store.save()
                return true
            }
        }
        return false
    }

    data class PollResult(val groups: Int, val sent: Int, val errors: List<Pair<String, String>>)

    @Synchronized
    fun poll(): PollResult {
        val subs = store.subscriptions.objects()
        val groups = subs.groupBy { "${Molit.apiForType(it.getString("type"))}:${it.getString("lawdCd")}" }
        val yms = Molit.recentYms(POLL_MONTHS, molit.today())
        var sent = 0
        val errors = mutableListOf<Pair<String, String>>()
        // 단지별로 모아서(매매·전세·월세 섞어) 알림 1개로 보냄
        data class Bucket(val sub: JSONObject, val fresh: MutableList<Deal> = mutableListOf(), val canceled: MutableList<Deal> = mutableListOf())
        val buckets = LinkedHashMap<String, Bucket>()

        for ((g, gsubs) in groups) {
            val (api, lawdCd) = g.split(":")
            try {
                ensureBaseline(api, lawdCd)
                val rec = seenFor(api, lawdCd)!!
                val prevMonths = rec.getJSONObject("months")
                val fresh = mutableListOf<Deal>()
                val canceled = mutableListOf<Deal>()
                val next = JSONObject()
                for (ym in yms) {
                    val deals = molit.fetchMonth(api, lawdCd, ym, force = true)
                    val prev = prevMonths.optJSONObject(ym) ?: JSONObject()
                    val cur = JSONObject()
                    for (d in deals) {
                        cur.put(d.key, if (d.canceled) "canceled" else "1")
                        if (!prev.has(d.key)) {
                            if (!d.canceled) fresh.add(d)
                        } else if (d.canceled && prev.getString(d.key) != "canceled") {
                            canceled.add(d)
                        }
                    }
                    for (k in prev.keys()) if (!cur.has(k)) cur.put(k, prev.get(k))
                    next.put(ym, cur)
                }
                rec.put("months", next)
                store.save()

                for (s in gsubs) {
                    val skip = s.optJSONArray("skipKeys")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
                    s.remove("skipKeys")
                    val type = s.getString("type")
                    val b = buckets.getOrPut("${s.getString("lawdCd")}:${s.getString("complexId")}") { Bucket(s) }
                    b.fresh += fresh.filter { it.complexId == s.getString("complexId") && it.type == type && it.key !in skip }
                    b.canceled += canceled.filter { it.complexId == s.getString("complexId") && it.type == type }
                }
            } catch (e: Exception) {
                errors.add(g to (e.message ?: e.javaClass.simpleName))
            }
        }
        val wantCanceled = Prefs.get(store.settings).optBoolean("notiCanceled", true)
        for (b in buckets.values) {
            if (!wantCanceled) b.canceled.clear()
            if (b.fresh.isEmpty() && b.canceled.isEmpty()) continue
            val apt = b.sub.getString("aptNm")
            val title = when {
                b.fresh.isNotEmpty() && b.canceled.isNotEmpty() -> "🏠 $apt 새 실거래 ${b.fresh.size}건 · 해제 ${b.canceled.size}건"
                b.fresh.isNotEmpty() -> "🏠 $apt 새 실거래 ${b.fresh.size}건 (${typeSummary(b.fresh)})"
                else -> "⚠️ $apt 거래 해제 ${b.canceled.size}건"
            }
            val all = b.fresh + b.canceled
            notify(b.sub, title, body(all), if (b.fresh.isNotEmpty()) "new" else "canceled", all, sorted(all).first().type)
            sent++
        }
        val keys = store.seen.keys().asSequence().toList()
        for (k in keys) if (k !in groups) store.seen.remove(k)
        store.data.put("lastPollAt", nowIso())
        store.save()
        return PollResult(groups.size, sent, errors)
    }
}
