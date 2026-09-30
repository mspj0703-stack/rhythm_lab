plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val companionKeystore = System.getenv("COMPANION_KEYSTORE_PATH")
val companionPassword = System.getenv("COMPANION_KEYSTORE_PASSWORD")

android {
    namespace = "com.rhythmlab.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rhythmlab.companion"
        minSdk = 26
        targetSdk = 35
        // This workflow's run number increases for each signed APK.
        versionCode = 475000 + (System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1)
        versionName = "4.75.0-rc.phase1"
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
