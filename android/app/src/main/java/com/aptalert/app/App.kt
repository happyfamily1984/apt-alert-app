package com.aptalert.app

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class App : Application() {
    lateinit var core: Core
        private set

    override fun onCreate() {
        super.onCreate()
        val regions = assets.open("www/regions.json").bufferedReader().use { it.readText() }
        core = Core(filesDir, cacheDir, regions, defaultHttp, AndroidNotifier(this), AndroidPlatform(this))
        AndroidNotifier.createChannel(this)
        if (core.store.subscriptions.length() > 0) schedulePolling(this, core.pollIntervalMinutes(), replace = false)
    }

    companion object {
        fun core(ctx: Context) = (ctx.applicationContext as App).core

        fun schedulePolling(ctx: Context, minutes: Int, replace: Boolean = true) {
            val req = PeriodicWorkRequestBuilder<PollWorker>(minutes.coerceAtLeast(15).toLong(), TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                "poll-deals",
                if (replace) ExistingPeriodicWorkPolicy.UPDATE else ExistingPeriodicWorkPolicy.KEEP,
                req,
            )
        }
    }
}

/** 백그라운드에서 주기적으로 새 실거래 확인 (WorkManager: 재부팅 후에도 유지) */
class PollWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val core = App.core(applicationContext)
        if (core.store.subscriptions.length() == 0) return Result.success()
        val r = core.alerts.poll()
        // 전부 실패(네트워크 등)면 잠시 후 재시도
        return if (r.groups > 0 && r.errors.size == r.groups) Result.retry() else Result.success()
    }
}

class AndroidNotifier(private val ctx: Context) : Notifier {
    companion object {
        const val CHANNEL = "deals"

        fun createChannel(ctx: Context) {
            val ch = NotificationChannel(CHANNEL, "실거래 알림", NotificationManager.IMPORTANCE_DEFAULT)
            ch.description = "관심 단지의 새 실거래·거래 해제 알림"
            ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    override fun show(id: Int, title: String, body: String, hash: String): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_HASH, hash)
        }
        val pi = PendingIntent.getActivity(ctx, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_house)
            .setColor(0xFF2563EB.toInt())
            .setContentTitle(title)
            .setContentText(body.lineSequence().firstOrNull() ?: "")
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
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
