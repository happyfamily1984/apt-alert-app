package com.aptalert.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    companion object {
        const val EXTRA_HASH = "hash"
        private const val HOST = "appassets.androidplatform.net"
        private const val START_URL = "https://$HOST/assets/www/index.html"
    }

    private lateinit var web: WebView
    private val executor = Executors.newFixedThreadPool(3)
    private var pendingPermissionCall: Int? = null
    private var pageReady = false
    private var pendingHash: String? = null

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        (App.core(this).platform as AndroidPlatform).markPermissionAsked()
        pendingPermissionCall?.let { resolve(it, JSONObject().put("status", 200).put("data", JSONObject().put("granted", granted)).toString()) }
        pendingPermissionCall = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#2563EB")

        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            setBackgroundColor(Color.parseColor("#F5F6F8"))
            addJavascriptInterface(Bridge(), "AndroidBridge")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == HOST) return false
                    // 외부 링크(공공데이터포털 등)는 브라우저로 열기
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }

                override fun onPageFinished(view: WebView, url: String) {
                    pageReady = true
                    pendingHash?.let { navigate(it) }
                    pendingHash = null
                }
            }
        }
        setContentView(web)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        pendingHash = intent.getStringExtra(EXTRA_HASH)
        web.loadUrl(START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_HASH)?.let { if (pageReady) navigate(it) else pendingHash = it }
    }

    private fun navigate(hash: String) {
        web.evaluateJavascript("window.__navigate && window.__navigate(${JSONObject.quote(hash)})", null)
    }

    private fun resolve(id: Int, json: String) {
        runOnUiThread { web.evaluateJavascript("window.__bridgeResolve($id, ${JSONObject.quote(json)})", null) }
    }

    inner class Bridge {
        @JavascriptInterface
        fun request(id: Int, method: String, path: String, body: String) {
            if (path.startsWith("/api/push/subscribe")) {
                runOnUiThread { requestNotificationPermission(id) }
                return
            }
            executor.execute { resolve(id, App.core(this@MainActivity).api.handle(method, path, body)) }
        }
    }

    private fun requestNotificationPermission(id: Int) {
        val needs = Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (!needs) {
            val granted = App.core(this).platform.notifyPermission() == "granted"
            resolve(id, JSONObject().put("status", 200).put("data", JSONObject().put("granted", granted)).toString())
            return
        }
        pendingPermissionCall = id
        permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }
}
