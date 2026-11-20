package com.aptalert.app

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import android.app.AlarmManager
import android.content.BroadcastReceiver
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.workDataOf
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import java.time.LocalTime
import org.json.JSONObject

class App : Application() {
    lateinit var core: Core
        private set

    override fun onCreate() {
        super.onCreate()
        val regions = assets.open("www/regions.json").bufferedReader().use { it.readText() }
        core = Core(
            filesDir, cacheDir, regions, defaultHttp, AndroidNotifier(this), AndroidPlatform(this),
            defaultProxyUrl = BuildConfig.PROXY_URL, proxyToken = BuildConfig.PROXY_TOKEN,
            relayOnly = BuildConfig.PROXY_URL.isNotBlank(),
        )
        (core.notifier as AndroidNotifier).ensureChannel()
        core.markAutoSince()
        if (core.store.subscriptions.length() > 0) schedulePolling(this, core.pollIntervalMinutes(), replace = false)
        else cancelAlarm(this)
    }

    companion object {
        fun core(ctx: Context) = (ctx.applicationContext as App).core

        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /**
         * 자동 확인 예약 (두 가지를 함께 사용 → 한쪽이 미뤄져도 다른 쪽이 확인)
         * 1) WorkManager 주기 작업  2) 절전 중에도 깨우는 알람(AlarmManager)
         */
        fun schedulePolling(ctx: Context, minutes: Int, replace: Boolean = true) {
            val req = PeriodicWorkRequestBuilder<PollWorker>(minutes.coerceAtLeast(15).toLong(), TimeUnit.MINUTES)
                .setConstraints(network)
                .setInputData(workDataOf("source" to "periodic"))
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                "poll-deals",
                if (replace) ExistingPeriodicWorkPolicy.UPDATE else ExistingPeriodicWorkPolicy.KEEP,
                req,
            )
            armAlarm(ctx, minutes)
        }

        /** 다음 알람 예약 (정확한 시각 권한이 필요 없는 방식, 절전 중에도 동작) */
        fun armAlarm(ctx: Context, minutes: Int) {
            val am = ctx.getSystemService(AlarmManager::class.java) ?: return
            val at = System.currentTimeMillis() + minutes.coerceAtLeast(15) * 60_000L
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(ctx))
        }

        fun cancelAlarm(ctx: Context) {
            ctx.getSystemService(AlarmManager::class.java)?.cancel(alarmIntent(ctx))
        }

        private fun alarmIntent(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
            ctx, 7001, Intent(ctx, PollAlarmReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        /** 지금 한 번 확인 작업 실행 (알람·재부팅 시) */
        fun pollSoon(ctx: Context, source: String) {
            val req = OneTimeWorkRequestBuilder<PollWorker>()
                .setConstraints(network)
                .setInputData(workDataOf("source" to source))
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("poll-once", ExistingWorkPolicy.KEEP, req)
        }
    }
}

/** 알람이 울리면 → 확인 작업 실행 + 다음 알람 예약 */
class PollAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val core = App.core(ctx)
        if (core.store.subscriptions.length() == 0) return
        App.pollSoon(ctx, "alarm")
        App.armAlarm(ctx, core.pollIntervalMinutes())
    }
}

/** 재부팅·앱 업데이트 후 자동 확인 다시 예약 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val core = App.core(ctx)
        if (core.store.subscriptions.length() == 0) return
        App.schedulePolling(ctx, core.pollIntervalMinutes(), replace = false)
        App.pollSoon(ctx, "boot")
    }
}

/** 백그라운드에서 새 실거래 확인 (주기 작업·알람·재부팅에서 실행) */
class PollWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val core = App.core(applicationContext)
        val source = inputData.getString("source") ?: "periodic"
        val r = core.runAutoPoll(source) ?: return Result.success() // 방금 확인했으면 건너뜀
        // 전부 실패(네트워크 등)면 잠시 후 재시도
        return if (r.groups > 0 && r.errors.size == r.groups) Result.retry() else Result.success()
    }
}

class AndroidNotifier(private val ctx: Context) : Notifier {
    companion object {
        private const val PREFIX = "deals"
        private const val QUIET = "deals_quiet"
    }

    private val nm get() = ctx.getSystemService(NotificationManager::class.java)
    private fun prefs() = Prefs.get(App.core(ctx).store.settings)

    /**
     * 안드로이드 8+ 는 채널을 만든 뒤엔 소리·진동을 앱이 바꿀 수 없음
     * → 설정 조합마다 채널을 만들고, 예전 채널은 지움
     */
    fun ensureChannel(p: JSONObject = prefs(), quiet: Boolean = false): String {
        if (quiet) {
            if (nm.getNotificationChannel(QUIET) == null) {
                val ch = NotificationChannel(QUIET, "실거래 알림 (조용한 시간)", NotificationManager.IMPORTANCE_LOW)
                ch.setSound(null, null)
                ch.enableVibration(false)
                nm.createNotificationChannel(ch)
            }
            return QUIET
        }
        val sound = p.optBoolean("notiSound", true)
        val uri = p.optString("soundUri")
        val vib = p.optBoolean("notiVibrate", true)
        val pattern = p.optString("vibratePattern", "short")
        val popup = p.optBoolean("notiPopup", true)
        val id = PREFIX + "_" + Integer.toHexString("$sound|$uri|$vib|$pattern|$popup".hashCode())
        if (nm.getNotificationChannel(id) == null) {
            val ch = NotificationChannel(
                id, "실거래 알림",
                if (popup) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT,
            )
            ch.description = "관심 단지의 새 실거래·거래 해제 알림"
            if (sound) {
                val attrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                ch.setSound(if (uri.isNotEmpty()) Uri.parse(uri) else Settings.System.DEFAULT_NOTIFICATION_URI, attrs)
            } else {
                ch.setSound(null, null)
            }
            ch.enableVibration(vib)
            if (vib) ch.vibrationPattern = Prefs.PATTERNS[pattern] ?: Prefs.PATTERNS.getValue("short")
            nm.createNotificationChannel(ch)
        }
        nm.notificationChannels
            .filter { it.id.startsWith(PREFIX) && it.id != id && it.id != QUIET }
            .forEach { nm.deleteNotificationChannel(it.id) }
        return id
    }

    override fun show(id: Int, title: String, body: String, hash: String): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        val p = prefs()
        val quiet = Prefs.isQuiet(p, LocalTime.now(KST))
        val channel = ensureChannel(p, quiet)
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_HASH, hash)
        }
        val pi = PendingIntent.getActivity(ctx, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val icon = when (p.optString("notiIcon")) {
            "building" -> R.drawable.ic_stat_building
            "bell" -> R.drawable.ic_stat_bell
            "chart" -> R.drawable.ic_stat_chart
            else -> R.drawable.ic_stat_house
        }
        val color = android.graphics.Color.parseColor(Prefs.notiColor(p))
        val builder = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(icon)
            .setColor(color)
            .setContentTitle(title)
            .setContentText(body.lineSequence().firstOrNull() ?: "")
            .setContentIntent(pi)
            .setAutoCancel(true)
        // 내용 표시: 자세히(펼친 목록) / 간단히(한 줄)
        if (p.optString("notiDetail") != "simple") builder.setStyle(NotificationCompat.BigTextStyle().bigText(body))
        // 잠금화면: 내용 숨기기
        if (p.optString("notiLockscreen") == "hide") {
            builder.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            builder.setPublicVersion(
                NotificationCompat.Builder(ctx, channel).setSmallIcon(icon).setColor(color)
                    .setContentTitle("실거래 알리미").setContentText("새 실거래 알림이 있어요").build(),
            )
        } else {
            builder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        }
        val n = builder.build()
        return try {
            NotificationManagerCompat.from(ctx).notify(id, n)
            true
        } catch (e: SecurityException) {
            false
        }
    }
}

class AndroidPlatform(private val ctx: Context) : Platform {
    private val prefs = ctx.getSharedPreferences("app", Context.MODE_PRIVATE)

    fun markPermissionAsked() = prefs.edit().putBoolean("notiAsked", true).apply()

    override fun notifyPermission(): String {
        val enabled = NotificationManagerCompat.from(ctx).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT < 33) return if (enabled) "granted" else "denied"
        val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        return when {
            granted && enabled -> "granted"
            granted || prefs.getBoolean("notiAsked", false) -> "denied"
            else -> "default"
        }
    }

    override fun schedulePolling(minutes: Int) = App.schedulePolling(ctx, minutes)

    override fun openNotificationSettings() {
        ctx.startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    override fun openBatterySettings() {
        // 앱 정보 화면 → 배터리 → '제한 없음' 선택 안내 (가장 호환성 좋은 방법)
        ctx.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    override val appVersion: String = BuildConfig.VERSION_NAME
}
