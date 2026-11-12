package com.aptalert.app

import org.json.JSONArray
import org.json.JSONObject
import org.w3c.dom.Element
import java.io.File
import java.io.StringReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import javax.xml.parsers.DocumentBuilderFactory
import org.xml.sax.InputSource

/** 화면에 그대로 보여줄 수 있는 메시지를 가진 오류 */
open class ApiError(val status: Int, message: String) : RuntimeException(message)

class MolitException(message: String) : ApiError(502, message)

val KST: ZoneId = ZoneId.of("Asia/Seoul")

/** 국토부 실거래 1건 (매매/전세/월세 공통) */
data class Deal(
    val type: String,
    val complexId: String,
    val aptNm: String,
    val umdNm: String,
    val jibun: String,
    val buildYear: Int?,
    val area: Double,
    val floor: Int,
    val date: String,
    val price: Long = 0,
    val dong: String = "",
    val dealingGbn: String = "",
    val canceled: Boolean = false,
    val cancelDate: String = "",
    val deposit: Long = 0,
    val monthlyRent: Long = 0,
    val contractType: String = "",
    val contractTerm: String = "",
    var key: String = "",
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("type", type); put("complexId", complexId); put("aptNm", aptNm); put("umdNm", umdNm)
        put("jibun", jibun); put("buildYear", buildYear ?: JSONObject.NULL); put("area", area)
        put("floor", floor); put("date", date); put("canceled", canceled); put("key", key)
        if (type == "trade") {
            put("price", price); put("dong", dong); put("dealingGbn", dealingGbn); put("cancelDate", cancelDate)
        } else {
            put("deposit", deposit); put("monthlyRent", monthlyRent)
            put("contractType", contractType); put("contractTerm", contractTerm)
        }
    }

    companion object {
        fun fromJson(o: JSONObject) = Deal(
            type = o.getString("type"), complexId = o.getString("complexId"), aptNm = o.optString("aptNm"),
            umdNm = o.optString("umdNm"), jibun = o.optString("jibun"),
            buildYear = if (o.isNull("buildYear")) null else o.optInt("buildYear"),
            area = o.optDouble("area", 0.0), floor = o.optInt("floor"), date = o.getString("date"),
            price = o.optLong("price"), dong = o.optString("dong"), dealingGbn = o.optString("dealingGbn"),
            canceled = o.optBoolean("canceled"), cancelDate = o.optString("cancelDate"),
            deposit = o.optLong("deposit"), monthlyRent = o.optLong("monthlyRent"),
            contractType = o.optString("contractType"), contractTerm = o.optString("contractTerm"),
            key = o.optString("key"),
        )
    }
}

object Molit {
    const val TRADE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
    const val RENT_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent"
    val TYPES = linkedMapOf("trade" to "매매", "jeonse" to "전세", "monthly" to "월세")

    fun apiForType(type: String) = if (type == "trade") "trade" else "rent"

    data class Parsed(val items: List<Map<String, String>>, val totalCount: Int)

    /** XML 응답 파싱 (javax DOM → 안드로이드/JVM 모두 동작) */
    fun parse(xml: String): Parsed {
        val doc = try {
            val f = DocumentBuilderFactory.newInstance()
            f.isNamespaceAware = false
            runCatching { f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
            f.newDocumentBuilder().parse(InputSource(StringReader(xml.trim())))
        } catch (e: Exception) {
            throw MolitException("국토부 서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.")
        }
        val root = doc.documentElement
        fun text(parent: Element, tag: String): String {
            val n = parent.getElementsByTagName(tag)
            return if (n.length > 0) n.item(0).textContent.trim() else ""
        }
        if (root.tagName == "OpenAPI_ServiceResponse") {
            throw MolitException(friendly(text(root, "returnAuthMsg").ifEmpty { text(root, "errMsg") }, text(root, "returnReasonCode")))
        }
        if (root.tagName != "response") throw MolitException("알 수 없는 응답 형식입니다.")
        val code = text(root, "resultCode")
        if (code != "00" && code != "000") throw MolitException(friendly(text(root, "resultMsg"), code))

        val list = mutableListOf<Map<String, String>>()
        val items = root.getElementsByTagName("item")
        for (i in 0 until items.length) {
            val item = items.item(i) as Element
            val m = HashMap<String, String>()
            val kids = item.childNodes
            for (j in 0 until kids.length) {
                val k = kids.item(j)
                if (k is Element) m[k.tagName] = k.textContent.trim()
            }
            list.add(m)
        }
        return Parsed(list, text(root, "totalCount").toIntOrNull() ?: 0)
    }

    fun friendly(msg: String, code: String): String = when {
        msg.contains("SERVICE_KEY_IS_NOT_REGISTERED") || msg.contains("SERVICE KEY") || code == "30" || code == "20" ->
            "API 키 인증에 실패했어요. 키를 정확히 복사했는지, 매매·전월세 두 API 모두 활용신청했는지 확인해 주세요. (승인 직후라면 1~2시간 뒤 다시 시도)"
        msg.contains("LIMITED_NUMBER") || code == "22" -> "오늘 API 호출 한도를 초과했어요. 내일 다시 시도해 주세요."
        msg.contains("DEADLINE") || code == "31" -> "API 활용기간이 만료됐어요. 공공데이터포털에서 연장 신청해 주세요."
        else -> "국토부 API 오류: $msg ($code)"
    }

    private fun num(s: String?): Double = s?.replace(",", "")?.trim()?.toDoubleOrNull() ?: 0.0

    fun complexKey(lawdCd: String, umdNm: String?, jibun: String?, aptNm: String?) =
        listOf(lawdCd, umdNm.orEmpty().trim(), jibun.orEmpty().trim(), aptNm.orEmpty().replace(Regex("\\s+"), "")).joinToString("|")

    fun complexId(key: String): String {
        val d = MessageDigest.getInstance("SHA-1").digest(key.toByteArray(Charsets.UTF_8))
        return d.joinToString("") { "%02x".format(it) }.substring(0, 12)
    }

    private fun date(it: Map<String, String>) =
        "%d-%02d-%02d".format(num(it["dealYear"]).toInt(), num(it["dealMonth"]).toInt(), num(it["dealDay"]).toInt())

    fun normalizeTrade(lawdCd: String, it: Map<String, String>) = Deal(
        type = "trade",
        complexId = complexId(complexKey(lawdCd, it["umdNm"], it["jibun"], it["aptNm"])),
        aptNm = it["aptNm"].orEmpty(), umdNm = it["umdNm"].orEmpty(), jibun = it["jibun"].orEmpty(),
        buildYear = num(it["buildYear"]).toInt().takeIf { y -> y > 0 },
        area = num(it["excluUseAr"]), floor = num(it["floor"]).toInt(), date = date(it),
        price = num(it["dealAmount"]).toLong(), dong = it["aptDong"].orEmpty(), dealingGbn = it["dealingGbn"].orEmpty(),
        canceled = it["cdealType"].orEmpty().trim() == "O", cancelDate = it["cdealDay"].orEmpty(),
    )

    fun normalizeRent(lawdCd: String, it: Map<String, String>): Deal {
        val rent = num(it["monthlyRent"]).toLong()
        return Deal(
            type = if (rent > 0) "monthly" else "jeonse",
            complexId = complexId(complexKey(lawdCd, it["umdNm"], it["jibun"], it["aptNm"])),
            aptNm = it["aptNm"].orEmpty(), umdNm = it["umdNm"].orEmpty(), jibun = it["jibun"].orEmpty(),
            buildYear = num(it["buildYear"]).toInt().takeIf { y -> y > 0 },
            area = num(it["excluUseAr"]), floor = num(it["floor"]).toInt(), date = date(it),
            deposit = num(it["deposit"]).toLong(), monthlyRent = rent,
            contractType = it["contractType"].orEmpty(), contractTerm = it["contractTerm"].orEmpty(),
        )
    }

    /** 거래 고유 키 (동일 조건 거래가 여러 건이면 #n 으로 구분) */
    fun assignKeys(deals: List<Deal>): List<Deal> {
        val seen = HashMap<String, Int>()
        for (d in deals) {
            val amount = if (d.type == "trade") "${d.price}" else "${d.deposit}/${d.monthlyRent}"
            val k = listOf(d.type, d.complexId, d.date, d.area, d.floor, amount, d.dong).joinToString("|")
            val n = (seen[k] ?: 0) + 1
            seen[k] = n
            d.key = "$k#$n"
        }
        return deals
    }

    /** 이번 달 포함 최근 n개월 YYYYMM */
    fun recentYms(n: Int, today: LocalDate): List<String> =
        (0 until n).map { today.withDayOfMonth(1).minusMonths(it.toLong()) }.map { "%d%02d".format(it.year, it.monthValue) }
}

fun interface HttpGet {
    fun get(url: String): Pair<Int, String>
}

val defaultHttp = HttpGet { url ->
    val c = URL(url).openConnection() as HttpURLConnection
    c.connectTimeout = 15000
    c.readTimeout = 25000
    try {
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else (c.errorStream ?: c.inputStream)
        code to stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    } catch (e: java.io.IOException) {
        throw MolitException("인터넷 연결을 확인해 주세요. (${e.javaClass.simpleName})")
    } finally {
        c.disconnect()
    }
}

/** 국토부 API 호출 + 캐시 (최근 2개월: 1시간, 이전 달: 7일 디스크 캐시) */
class MolitClient(
    private val keyProvider: () -> String,
    private val http: HttpGet,
    private val cacheDir: File?,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val mem = ConcurrentHashMap<String, Pair<Long, List<Deal>>>()
    private val pool = Executors.newFixedThreadPool(4)

    fun today(): LocalDate = java.time.Instant.ofEpochMilli(clock()).atZone(KST).toLocalDate()

    private fun encodeKey(key: String) =
        if (Regex("%[0-9A-Fa-f]{2}").containsMatchIn(key)) key else URLEncoder.encode(key, "UTF-8")

    fun fetchLive(api: String, lawdCd: String, ym: String, key: String = keyProvider()): List<Deal> {
        val k = key.trim()
        if (k.isEmpty()) throw ApiError(400, "API 키가 설정되지 않았어요. ⚙️ 설정에서 국토교통부 API 키를 입력해 주세요.")
        val base = if (api == "trade") Molit.TRADE_URL else Molit.RENT_URL
        val all = mutableListOf<Map<String, String>>()
        for (page in 1..50) {
            val url = "$base?serviceKey=${encodeKey(k)}&LAWD_CD=$lawdCd&DEAL_YMD=$ym&pageNo=$page&numOfRows=1000"
            val (status, body) = http.get(url)
            if (!body.trimStart().startsWith("<")) {
                throw MolitException(
                    if (status == 401 || status == 403 || body.contains("Unauthorized", true)) Molit.friendly("SERVICE_KEY_IS_NOT_REGISTERED", "30")
                    else "국토부 서버 오류 (HTTP $status). 잠시 후 다시 시도해 주세요.",
                )
            }
            val parsed = Molit.parse(body)
            all.addAll(parsed.items)
            if (parsed.items.isEmpty() || all.size >= parsed.totalCount) break
        }
        val deals = all.map { if (api == "trade") Molit.normalizeTrade(lawdCd, it) else Molit.normalizeRent(lawdCd, it) }
        return Molit.assignKeys(deals)
    }

    private fun diskFile(ck: String) = cacheDir?.let { File(it, "molit/${ck.replace(':', '_')}.json") }

    fun fetchMonth(api: String, lawdCd: String, ym: String, force: Boolean = false): List<Deal> {
        val ck = "$api:$lawdCd:$ym"
        val recent = ym in Molit.recentYms(2, today())
        val ttl = if (recent) 60 * 60 * 1000L else 7 * 24 * 3600 * 1000L
        val now = clock()
        if (!force) {
            mem[ck]?.let { if (now - it.first < ttl) return it.second }
            if (!recent) diskFile(ck)?.takeIf { it.exists() }?.let { f ->
                runCatching {
                    val o = JSONObject(f.readText())
                    if (now - o.getLong("at") < ttl) {
                        val arr = o.getJSONArray("deals")
                        val deals = (0 until arr.length()).map { Deal.fromJson(arr.getJSONObject(it)) }
                        mem[ck] = o.getLong("at") to deals
                        return deals
                    }
                }
            }
        }
        val deals = fetchLive(api, lawdCd, ym)
        mem[ck] = now to deals
        if (!recent) diskFile(ck)?.let { f ->
            runCatching {
                f.parentFile?.mkdirs()
                f.writeText(JSONObject().put("at", now).put("deals", JSONArray(deals.map { it.toJson() })).toString())
            }
        }
        return deals
    }

    fun fetchMonths(api: String, lawdCd: String, months: Int): List<Deal> {
        val futures = Molit.recentYms(months, today()).map { ym -> pool.submit(Callable { fetchMonth(api, lawdCd, ym) }) }
        return futures.flatMap {
            try {
                it.get()
            } catch (e: ExecutionException) {
                throw e.cause ?: e
            }
        }
    }
}
