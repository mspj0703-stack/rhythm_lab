plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val companionKeystore = System.getenv("COMPANION_KEYSTORE_PATH")
val companionPassword = System.getenv("COMPANION_KEYSTORE_PASSWORD")
val beatdashVersion = rootProject.file("../web/VERSION").readText().trim().also {
    require(it.isNotBlank()) { "web/VERSION must not be empty" }
}
val versionCore = beatdashVersion.substringBefore("-").split(".")
require(versionCore.size == 3) { "VERSION must start with major.minor.patch" }
val versionMajor = versionCore[0].toInt()
val versionMinor = versionCore[1].toInt()
val versionPatch = versionCore[2].toInt()
val buildSequence = (System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1) % 10000
val beatdashVersionCode = versionMajor * 100_000_000 + versionMinor * 1_000_000 + versionPatch * 10_000 + buildSequence


android {
    namespace = "com.rhythmlab.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rhythmlab.companion"
        minSdk = 26
        targetSdk = 35
        // Release identity comes from web/VERSION; CI run number only makes APK builds monotonic within that release.
        versionCode = beatdashVersionCode
        versionName = beatdashVersion
    }

    if (companionKeystore != null && companionPassword != null) {
        signingConfigs {
            create("companion") {
                storeFile = file(companionKeystore)
                storePassword = companionPassword
                keyAlias = "companion"
                keyPassword = companionPassword
            }
        }
    }

    buildTypes {
        release {
            if (companionKeystore != null && companionPassword != null) {
                signingConfig = signingConfigs.getByName("companion")
            }
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    packaging {
        jniLibs.useLegacyPackaging = true
        resources.excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*")
    }
}

dependencies {
    val ytdlpAndroid = "0.18.1"

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("io.github.junkfood02.youtubedl-android:library:$ytdlpAndroid")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:$ytdlpAndroid")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
