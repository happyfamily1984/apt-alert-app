package com.aptalert.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URLDecoder

/** 안드로이드 기능 (테스트에서는 가짜 구현 사용) */
interface Platform {
    fun notifyPermission(): String // granted | denied | default
    fun schedulePolling(minutes: Int)
    fun openNotificationSettings()
    fun openBatterySettings()
    val appVersion: String
}

/** 앱 전체 구성 요소 */
class Core(
    filesDir: File?,
    cacheDir: File?,
    regionsJson: String,
    http: HttpGet,
    val notifier: Notifier,
    val platform: Platform,
    clock: () -> Long = System::currentTimeMillis,
) {
    val store = Store(filesDir?.let { File(it, "db.json") })
    val regions = Regions(regionsJson)
    val molit = MolitClient({ store.settings.optString("serviceKey") }, http, cacheDir, clock)
    val service = Service(molit)
    val alerts = Alerts(store, molit, service, notifier, clock)
    val api = Api(this)

    fun pollIntervalMinutes() = store.settings.optInt("pollIntervalMinutes", 180)
}

/**
 * 웹 UI(public/app.js)가 Node 서버에 보내던 것과 같은 REST 요청을 앱 안에서 처리.
 * 응답: {"status": 200, "data": {...}}
 */
class Api(private val core: Core) {
    private val types = Molit.TYPES

    fun handle(method: String, pathWithQuery: String, body: String): String {
        return try {
            JSONObject().put("status", 200).put("data", route(method.uppercase(), pathWithQuery, body)).toString()
        } catch (e: ApiError) {
            err(e.status, e.message ?: "오류")
        } catch (e: Exception) {
            err(500, e.message ?: e.javaClass.simpleName)
        }
    }

    private fun err(status: Int, msg: String) =
        JSONObject().put("status", status).put("data", JSONObject().put("error", msg)).toString()

    private fun region(code: String): String =
        core.regions.get(code)?.getString("code") ?: throw ApiError(404, "알 수 없는 시군구 코드")

    private fun route(method: String, pathWithQuery: String, rawBody: String): Any {
        val path = pathWithQuery.substringBefore('?')
        val query = pathWithQuery.substringAfter('?', "").split('&').filter { it.contains('=') }
            .associate { URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
        val body = if (rawBody.isBlank()) JSONObject() else JSONObject(rawBody)
        val p = path.trim('/').split('/') // ["api", ...]
        if (p.firstOrNull() != "api") throw ApiError(404, "not found")
        val r = p.drop(1)

        return when {
            method == "GET" && r == listOf("config") -> JSONObject()
                .put("demo", false).put("app", true).put("vapidPublicKey", JSONObject.NULL)
                .put("lastPollAt", core.store.data.opt("lastPollAt") ?: JSONObject.NULL)
                .put("hasKey", core.store.settings.optString("serviceKey").isNotBlank())
                .put("pollIntervalMinutes", core.pollIntervalMinutes())
                .put("notifyPermission", core.platform.notifyPermission())
                .put("appVersion", core.platform.appVersion)
                .put("dealTypes", JSONObject(types as Map<*, *>))

            method == "GET" && r == listOf("regions") -> core.regions.raw

            method == "GET" && r.size == 3 && r[0] == "regions" && r[2] == "complexes" -> {
                val code = region(r[1])
                JSONObject().put("region", core.regions.get(code)).put("complexes", JSONArray(core.service.getComplexes(code)))
            }

            method == "GET" && r.size == 3 && r[0] == "complexes" -> {
                val c = core.service.getComplex(region(r[1]), r[2]) ?: throw ApiError(404, "단지를 찾을 수 없습니다")
                JSONObject(c.toString()).put("region", core.regions.get(c.getString("lawdCd")))
            }

            method == "GET" && r.size == 4 && r[0] == "complexes" && r[3] == "deals" -> {
                val type = query["type"] ?: "trade"
                if (type !in types) throw ApiError(400, "type은 trade|jeonse|monthly")
                val months = (query["months"]?.toIntOrNull() ?: core.service.complexMonths).coerceIn(1, 36)
                val deals = core.service.getDeals(region(r[1]), r[2], type, months)
                val since = core.molit.today().minusDays(30).toString()
                JSONObject().put("type", type).put("months", months)
                    .put("deals", JSONArray(deals.map { it.toJson() }))
                    .put("summary30", Service.summarize(deals.filter { it.date >= since }))
                    .put("summaryAll", Service.summarize(deals))
            }

            // ----- 구독 -----
            method == "GET" && r == listOf("subscriptions") -> synchronized(core.alerts) {
                JSONArray(core.store.subscriptions.objects().map { s ->
                    JSONObject(s.toString()).apply { remove("skipKeys"); put("region", core.regions.get(s.getString("lawdCd"))) }
                })
            }

            method == "POST" && r == listOf("subscriptions") -> {
                val lawd = body.optString("lawdCd")
                if (core.regions.get(lawd) == null) throw ApiError(400, "lawdCd가 올바르지 않습니다")
                val (sub, recent) = core.alerts.subscribe(lawd, body.optString("complexId"), body.optString("type"))
                core.platform.schedulePolling(core.pollIntervalMinutes())
                JSONObject().put("subscription", JSONObject(sub.toString()).apply { remove("skipKeys") }).put("recentCount", recent)
            }

            method == "DELETE" && r.size == 2 && r[0] == "subscriptions" -> JSONObject().put("ok", core.alerts.unsubscribe(r[1]))

            // ----- 알림함 -----
            method == "GET" && r == listOf("notifications") -> synchronized(core.alerts) {
                val list = core.store.notifications.objects().reversed().take(100)
                JSONObject().put("unread", list.count { !it.optBoolean("read") }).put("notifications", JSONArray(list.map { JSONObject(it.toString()) }))
            }

            method == "POST" && r == listOf("notifications", "read-all") -> synchronized(core.alerts) {
                core.store.notifications.objects().forEach { it.put("read", true) }
                core.store.save()
                JSONObject().put("ok", true)
            }

            method == "POST" && r == listOf("push", "test") -> {
                val ok = core.notifier.show(1, "🔔 테스트 알림", "알림이 정상적으로 동작합니다.", "#/alerts")
                JSONObject().put("ok", true).put("devices", if (ok) 1 else 0)
            }

            method == "POST" && r == listOf("admin", "poll") -> {
                val res = core.alerts.poll()
                JSONObject().put("groups", res.groups).put("notificationsSent", res.sent)
                    .put("errors", JSONArray(res.errors.map { JSONObject().put("group", it.first).put("error", it.second) }))
            }

            // ----- 설정 -----
            method == "GET" && r == listOf("settings") -> {
                val key = core.store.settings.optString("serviceKey")
                JSONObject().put("serviceKeySet", key.isNotBlank())
                    .put("serviceKeyMasked", if (key.length > 8) key.take(4) + "••••" + key.takeLast(4) else if (key.isNotEmpty()) "••••" else "")
                    .put("pollIntervalMinutes", core.pollIntervalMinutes())
            }

            method == "POST" && r == listOf("settings") -> {
                if (body.has("serviceKey")) core.store.settings.put("serviceKey", body.getString("serviceKey").trim())
                if (body.has("pollIntervalMinutes")) {
                    core.store.settings.put("pollIntervalMinutes", body.getInt("pollIntervalMinutes").coerceIn(15, 1440))
                    core.platform.schedulePolling(core.pollIntervalMinutes())
                }
                core.store.save()
                JSONObject().put("ok", true)
            }

            method == "POST" && r == listOf("settings", "test") -> {
                val key = body.optString("serviceKey").ifBlank { core.store.settings.optString("serviceKey") }
                val ym = Molit.recentYms(2, core.molit.today())[1] // 지난달
                val trade = try { core.molit.fetchLive("trade", "11680", ym, key).size } catch (e: ApiError) {
                    throw ApiError(e.status, "[매매 API] ${e.message}")
                }
                val rent = try { core.molit.fetchLive("rent", "11680", ym, key).size } catch (e: ApiError) {
                    throw ApiError(e.status, "[전월세 API] ${e.message}")
                }
                JSONObject().put("ok", true).put("trade", trade).put("rent", rent)
            }

            method == "POST" && r == listOf("app", "open-notification-settings") -> { core.platform.openNotificationSettings(); JSONObject().put("ok", true) }
            method == "POST" && r == listOf("app", "open-battery-settings") -> { core.platform.openBatterySettings(); JSONObject().put("ok", true) }

            else -> throw ApiError(404, "not found: $method $path")
        }
    }
}
