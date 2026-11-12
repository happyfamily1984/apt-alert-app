package com.aptalert.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate
import java.time.ZonedDateTime

class CoreTest {
    private fun res(name: String) = javaClass.classLoader!!.getResource(name)!!.readText()

    @Test fun parseTradeAndRent() {
        val t = Molit.parse(res("trade.xml"))
        assertEquals(2, t.totalCount)
        val a = Molit.normalizeTrade("11650", t.items[0])
        assertEquals(452000L, a.price)
        assertEquals("2026-11-03", a.date)
        assertEquals(84.93, a.area, 0.001)
        assertEquals("101", a.dong)
        assertFalse(a.canceled)
        assertTrue(Molit.normalizeTrade("11650", t.items[1]).canceled)

        val r = Molit.parse(res("rent.xml")).items.map { Molit.normalizeRent("11650", it) }
        assertEquals("jeonse", r[0].type)
        assertEquals("monthly", r[1].type)
        assertEquals(320L, r[1].monthlyRent)
        assertEquals(a.complexId, r[0].complexId) // 단지명 공백 차이 무시
    }

    @Test fun complexIdMatchesNodeServer() {
        // Node: crypto sha1('11650|반포동|1|래미안퍼스티지').slice(0,12)
        assertEquals(12, Molit.complexId(Molit.complexKey("11650", "반포동", "1", "래미안 퍼스티지")).length)
    }

    @Test(expected = MolitException::class) fun authError() {
        Molit.parse("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>")
    }

    @Test fun keysUniqueAndFormat() {
        val d = Deal("trade", "x", "a", "b", "1", null, 84.0, 3, "2026-11-01", price = 100)
        val ks = Molit.assignKeys(listOf(d.copy(), d.copy()))
        assertNotEquals(ks[0].key, ks[1].key)
        assertEquals(listOf("202601", "202512"), Molit.recentYms(2, LocalDate.of(2026, 1, 15)))
        assertEquals("15억 2,000만", Fmt.manwon(152000))
        assertEquals("9,500만", Fmt.manwon(9500))
    }

    // ----- 통합: 가짜 국토부 서버로 구독 → 폴링 → 알림 -----
    private class FakeServer {
        val trades = mutableListOf<String>()
        val rents = mutableListOf<String>()
        var calls = 0
        fun rent(day: Int, deposit: String, monthly: String, floor: Int) =
            "<item><aptNm>테스트 아파트</aptNm><umdNm>반포동</umdNm><jibun>1</jibun><buildYear>2009</buildYear><dealYear>2026</dealYear><dealMonth>11</dealMonth><dealDay>$day</dealDay><deposit>$deposit</deposit><monthlyRent>$monthly</monthlyRent><excluUseAr>84.9329</excluUseAr><floor>$floor</floor></item>"
        fun item(day: Int, amount: String, floor: Int, canceled: Boolean = false) =
            "<item><aptNm>테스트 아파트</aptNm><umdNm>반포동</umdNm><jibun>1</jibun><buildYear>2009</buildYear><dealYear>2026</dealYear><dealMonth>11</dealMonth><dealDay>$day</dealDay><dealAmount>$amount</dealAmount><excluUseAr>84.9</excluUseAr><floor>$floor</floor><cdealType>${if (canceled) "O" else ""}</cdealType></item>"
        var lastHeaders: Map<String, String> = emptyMap()
        val http = HttpGet { url, headers ->
            calls++
            lastHeaders = headers
            if (url.startsWith("https://proxy.test/")) {
                if (headers["X-App-Token"] != "tok") return@HttpGet 403 to "{\"error\":\"중계 서버 접근 토큰이 맞지 않아요\"}"
            } else if (!url.contains("serviceKey=good")) return@HttpGet 401 to "Unauthorized"
            val ym = Regex("DEAL_YMD=(\\d+)").find(url)!!.groupValues[1]
            val isTrade = url.contains("AptTrade") || url.contains("/molit/trade")
            val list = if (isTrade) trades else rents
            val items = if (ym == "202611") list.joinToString("") else ""
            200 to "<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>$items</items><totalCount>${if (items.isEmpty()) 0 else list.size}</totalCount></body></response>"
        }
    }

    private val shown = mutableListOf<Pair<String, String>>()
    private val platform = object : Platform {
        override fun notifyPermission() = "granted"
        override fun schedulePolling(minutes: Int) {}
        override fun openNotificationSettings() {}
        override fun openBatterySettings() {}
        override val appVersion = "test"
    }
    private val regions = File("../../shared/regions.json").readText()
    private val clock = { ZonedDateTime.of(2026, 11, 12, 10, 0, 0, 0, KST).toInstant().toEpochMilli() }

    private fun core(server: FakeServer, dir: File? = null, proxy: String = "", token: String = "", relayOnly: Boolean = false) =
        Core(dir, null, regions, server.http, { _, t, b, _ -> shown.add(t to b); true }, platform, clock, proxy, token, relayOnly)

    private fun call(c: Core, m: String, p: String, body: String = "") = JSONObject(c.api.handle(m, p, body))

    @Test fun endToEnd() {
        val s = FakeServer()
        s.trades += s.item(3, "300,000", 5)
        val c = core(s)

        // 키 없음 → 안내 메시지
        val noKey = call(c, "GET", "/api/regions/11650/complexes")
        assertEquals(400, noKey.getInt("status"))
        assertTrue(noKey.getJSONObject("data").getString("error").contains("데이터 연결"))

        // 잘못된 키 → 인증 실패 안내
        val bad = call(c, "POST", "/api/settings/test", """{"serviceKey":"bad"}""")
        assertEquals(502, bad.getInt("status"))
        assertTrue(bad.getJSONObject("data").getString("error").contains("[매매]"))

        assertEquals(200, call(c, "POST", "/api/settings/test", """{"serviceKey":"good"}""").getInt("status"))
        call(c, "POST", "/api/settings", """{"serviceKey":"good"}""")
        assertTrue(call(c, "GET", "/api/config").getJSONObject("data").getBoolean("hasKey"))

        val list = call(c, "GET", "/api/regions/11650/complexes").getJSONObject("data").getJSONArray("complexes")
        assertEquals(1, list.length())
        val id = list.getJSONObject(0).getString("id")
        assertEquals(1, list.getJSONObject(0).getJSONObject("counts").getInt("trade"))

        val deals = call(c, "GET", "/api/complexes/11650/$id/deals?type=trade").getJSONObject("data")
        assertEquals(1, deals.getJSONArray("deals").length())
        assertEquals(1, deals.getJSONObject("summary30").getInt("count"))

        // 구독 → 최근 한 달 1건 알림
        val sub = call(c, "POST", "/api/subscriptions", """{"lawdCd":"11650","complexId":"$id","type":"trade"}""")
        assertEquals(1, sub.getJSONObject("data").getInt("recentCount"))
        assertTrue(shown.last().first.contains("테스트 아파트 매매 알림 시작"))

        // 변화 없음
        assertEquals(0, call(c, "POST", "/api/admin/poll").getJSONObject("data").getInt("notificationsSent"))

        // 새 거래 신고 → 알림
        s.trades += s.item(10, "310,000", 9)
        val r = call(c, "POST", "/api/admin/poll").getJSONObject("data")
        assertEquals(1, r.getInt("notificationsSent"))
        assertTrue(shown.last().first.contains("새 실거래 1건"))
        assertTrue(shown.last().second.contains("31억"))
        assertEquals(0, call(c, "POST", "/api/admin/poll").getJSONObject("data").getInt("notificationsSent"))

        // 거래 해제 → 알림
        s.trades[0] = s.item(3, "300,000", 5, canceled = true)
        call(c, "POST", "/api/admin/poll")
        assertTrue(shown.last().first.contains("거래 해제"))

        val inbox = call(c, "GET", "/api/notifications").getJSONObject("data")
        assertEquals(3, inbox.getInt("unread"))
        call(c, "POST", "/api/notifications/read-all")
        assertEquals(0, call(c, "GET", "/api/notifications").getJSONObject("data").getInt("unread"))

        // 구독 해제 + 저장소 영속성
        val subs = call(c, "GET", "/api/subscriptions").getJSONArray("data")
        assertEquals(1, subs.length())
        assertFalse(subs.getJSONObject(0).has("skipKeys"))
        val del = call(c, "DELETE", "/api/subscriptions/${subs.getJSONObject(0).getString("id")}")
        assertTrue(del.getJSONObject("data").getBoolean("ok"))
        assertEquals(0, call(c, "GET", "/api/subscriptions").getJSONArray("data").length())
    }

    @Test fun mergedNotificationPerComplex() {
        val s = FakeServer()
        s.trades += s.item(3, "300,000", 5)
        val c = core(s)
        call(c, "POST", "/api/settings", """{"serviceKey":"good"}""")
        val id = call(c, "GET", "/api/regions/11650/complexes").getJSONObject("data").getJSONArray("complexes").getJSONObject(0).getString("id")
        for (t in listOf("trade", "jeonse", "monthly")) call(c, "POST", "/api/subscriptions", """{"lawdCd":"11650","complexId":"$id","type":"$t"}""")
        shown.clear()

        // 한 번의 확인에서 매매 1 + 전세 1 + 월세 1 → 휴대폰 알림 1개
        s.trades += s.item(10, "310,000", 9)
        s.rents += s.rent(9, "150,000", "0", 3)
        s.rents += s.rent(11, "50,000", "320", 7)
        val r = call(c, "POST", "/api/admin/poll").getJSONObject("data")
        assertEquals(1, r.getInt("notificationsSent"))
        assertEquals(1, shown.size)
        val (title, body) = shown[0]
        assertTrue(title, title.contains("새 실거래 3건") && title.contains("매매 1 · 전세 1 · 월세 1"))
        // 최신 계약일 순, 유형 표시, 면적 소수 둘째 자리
        val lines = body.lines()
        assertTrue(lines[0], lines[0].startsWith("[월세]") && lines[0].contains("11/11"))
        assertTrue(lines[1], lines[1].startsWith("[매매]") && lines[1].contains("11/10"))
        assertTrue(lines[2], lines[2].startsWith("[전세]") && lines[2].contains("84.93㎡"))
        // 알림함 항목에 거래 데이터와 단지명 저장
        val n = call(c, "GET", "/api/notifications").getJSONObject("data").getJSONArray("notifications").getJSONObject(0)
        assertEquals("테스트 아파트", n.getString("aptNm"))
        assertEquals(3, n.getJSONArray("deals").length())
        assertEquals("monthly", n.getString("type"))
    }

    @Test fun relayOnlyIgnoresPersonalSettings() {
        val s = FakeServer()
        s.trades += s.item(3, "300,000", 5)
        val dir = createTempDir()
        // 예전 버전에서 개인 키·다른 주소를 저장해 둔 상태
        core(s, dir).let { call(it, "POST", "/api/settings", """{"serviceKey":"good","proxyUrl":"https://old.test"}""") }
        val c = core(s, dir, proxy = "https://proxy.test", token = "tok", relayOnly = true)
        val cfg = call(c, "GET", "/api/config").getJSONObject("data")
        assertTrue(cfg.getBoolean("relayOnly"))
        assertEquals("proxy", cfg.getString("dataSource"))
        assertEquals(1, call(c, "GET", "/api/regions/11650/complexes").getJSONObject("data").getJSONArray("complexes").length())
        assertEquals("tok", s.lastHeaders["X-App-Token"]) // 중계 서버로 감
        call(c, "POST", "/api/settings", """{"serviceKey":"x"}""") // 무시됨
        assertEquals("proxy", call(c, "GET", "/api/config").getJSONObject("data").getString("dataSource"))
        dir.deleteRecursively()
    }

    @Test fun prefsValidationAndQuietHours() {
        val settings = JSONObject()
        val p = Prefs.merge(settings, JSONObject()
            .put("accent", "purple").put("theme", "dark").put("fontScale", 115)
            .put("vibratePattern", "triple").put("notiSound", false)
            .put("accent2", "x").put("fontScale2", 1)            // 없는 키 무시
            .put("quietStart", "25:00"))                          // 잘못된 시각 무시
        assertEquals("purple", p.getString("accent"))
        assertEquals("dark", p.getString("theme"))
        assertEquals(115, p.getInt("fontScale"))
        assertEquals("triple", p.getString("vibratePattern"))
        assertFalse(p.getBoolean("notiSound"))
        assertEquals("22:00", p.getString("quietStart"))
        assertFalse(p.has("accent2"))
        assertEquals("#A78BFA", Prefs.accentColor(p, true))
        Prefs.merge(settings, JSONObject().put("accent", "rainbow").put("fontScale", 999).put("soundUri", "file:///sdcard/x.mp3"))
        assertEquals("purple", Prefs.get(settings).getString("accent"))
        assertEquals("", Prefs.get(settings).getString("soundUri"))

        val q = Prefs.defaults().put("quietEnabled", true).put("quietStart", "22:00").put("quietEnd", "08:00")
        assertTrue(Prefs.isQuiet(q, java.time.LocalTime.of(23, 30)))
        assertTrue(Prefs.isQuiet(q, java.time.LocalTime.of(7, 59)))
        assertFalse(Prefs.isQuiet(q, java.time.LocalTime.of(8, 0)))
        assertFalse(Prefs.isQuiet(q, java.time.LocalTime.of(12, 0)))
        val day = Prefs.defaults().put("quietEnabled", true).put("quietStart", "13:00").put("quietEnd", "14:00")
        assertTrue(Prefs.isQuiet(day, java.time.LocalTime.of(13, 30)))
        assertFalse(Prefs.isQuiet(day, java.time.LocalTime.of(14, 30)))
        assertFalse(Prefs.isQuiet(Prefs.defaults(), java.time.LocalTime.of(23, 0))) // 꺼져 있으면 항상 false
    }

    @Test fun canceledAlertsCanBeTurnedOff() {
        val s = FakeServer()
        s.trades += s.item(3, "300,000", 5)
        val c = core(s)
        call(c, "POST", "/api/settings", """{"serviceKey":"good","prefs":{"notiCanceled":false}}""")
        assertFalse(call(c, "GET", "/api/settings").getJSONObject("data").getJSONObject("prefs").getBoolean("notiCanceled"))
        val id = call(c, "GET", "/api/regions/11650/complexes").getJSONObject("data").getJSONArray("complexes").getJSONObject(0).getString("id")
        call(c, "POST", "/api/subscriptions", """{"lawdCd":"11650","complexId":"$id","type":"trade"}""")
        shown.clear()
        s.trades[0] = s.item(3, "300,000", 5, canceled = true)
        assertEquals(0, call(c, "POST", "/api/admin/poll").getJSONObject("data").getInt("notificationsSent"))
        assertTrue(shown.isEmpty())
    }

    @Test fun proxyMode() {
        val s = FakeServer()
        s.trades += s.item(3, "300,000", 5)
        // APK 기본 중계 서버 사용 → 키 입력 없이 바로 동작
        val c = core(s, proxy = "https://proxy.test", token = "tok")
        val cfg = call(c, "GET", "/api/config").getJSONObject("data")
        assertTrue(cfg.getBoolean("hasKey"))
        assertEquals("proxy", cfg.getString("dataSource"))
        val list = call(c, "GET", "/api/regions/11650/complexes").getJSONObject("data").getJSONArray("complexes")
        assertEquals(1, list.length())
        assertEquals("tok", s.lastHeaders["X-App-Token"])
        val t = call(c, "POST", "/api/settings/test").getJSONObject("data")
        assertEquals("proxy", t.getString("via"))

        // 토큰이 틀린 중계 서버 → 서버 메시지 그대로 표시
        val bad = core(FakeServer(), proxy = "https://proxy.test", token = "nope")
        val e = call(bad, "GET", "/api/regions/11650/complexes")
        assertEquals(502, e.getInt("status"))
        assertTrue(e.getJSONObject("data").getString("error").contains("토큰"))

        // 개인 키를 넣으면 개인 키 우선, 지우면 다시 중계 서버
        call(c, "POST", "/api/settings", """{"serviceKey":"good"}""")
        assertEquals("key", call(c, "GET", "/api/config").getJSONObject("data").getString("dataSource"))
        call(c, "POST", "/api/settings", """{"serviceKey":""}""")
        assertEquals("proxy", call(c, "GET", "/api/config").getJSONObject("data").getString("dataSource"))

        // http:// 주소 거부
        call(c, "POST", "/api/settings", """{"proxyUrl":"http://insecure.test"}""")
        assertTrue(call(c, "POST", "/api/settings/test").getJSONObject("data").getString("error").contains("https"))
    }

    @Test fun persistsToDisk() {
        val dir = createTempDir()
        val s = FakeServer()
        val c1 = core(s, dir)
        call(c1, "POST", "/api/settings", """{"serviceKey":"good","pollIntervalMinutes":60}""")
        val c2 = core(s, dir)
        val st = call(c2, "GET", "/api/settings").getJSONObject("data")
        assertTrue(st.getBoolean("serviceKeySet"))
        assertEquals(60, st.getInt("pollIntervalMinutes"))
        dir.deleteRecursively()
    }
}
