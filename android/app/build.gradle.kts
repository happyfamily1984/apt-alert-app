import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 서명 정보: android/keystore.properties 또는 환경변수(CI). 없으면 디버그 키로 서명.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(name: String): String? = keystoreProps.getProperty(name) ?: System.getenv("ANDROID_${name.uppercase()}")

android {
    namespace = "com.aptalert.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.aptalert.app"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "11").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "1.2.2"

        // 기본 중계 서버 주소: 환경변수 PROXY_URL 또는 android/proxy.properties 의 url=
        val proxyProps = Properties().apply {
            val f = rootProject.file("proxy.properties")
            if (f.exists()) f.inputStream().use { load(it) }
        }
        val proxyUrl = System.getenv("PROXY_URL")?.takeIf { it.isNotBlank() } ?: proxyProps.getProperty("url", "")
        val proxyToken = System.getenv("PROXY_TOKEN")?.takeIf { it.isNotBlank() } ?: proxyProps.getProperty("token", "")
        buildConfigField("String", "PROXY_URL", "\"${proxyUrl.trim()}\"")
        buildConfigField("String", "PROXY_TOKEN", "\"${proxyToken.trim()}\"")
    }

    signingConfigs {
        create("release") {
            val store = signingValue("storeFile")
            if (store != null && file(store).exists()) {
                storeFile = file(store)
                storePassword = signingValue("storePassword")
                keyAlias = signingValue("keyAlias")
                keyPassword = signingValue("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val release = signingConfigs.getByName("release")
            signingConfig = if (release.storeFile != null) release else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { buildConfig = true }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))
    lint { abortOnError = false }
}

// 웹 UI(public/)와 시군구 목록(shared/)을 앱 assets/www 로 복사 → 웹/앱이 같은 화면을 사용
val copyWebAssets by tasks.registering(Sync::class) {
    from(rootProject.file("../public")) { exclude("sw.js", "manifest.webmanifest") }
    from(rootProject.file("../shared/regions.json"))
    into(layout.buildDirectory.dir("generated/webassets/www"))
}
tasks.named("preBuild") { dependsOn(copyWebAssets) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
