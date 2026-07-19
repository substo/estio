import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val releaseProperties = Properties().apply {
    val file = rootProject.file("release.properties")
    if (file.exists()) {
        file.inputStream().use { load(it) }
    }
}

fun releaseValue(propertyName: String, envName: String): String? {
    return (releaseProperties.getProperty(propertyName) ?: System.getenv(envName))
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
}

val releaseStoreFile = releaseValue("SIMRELAY_UPLOAD_STORE_FILE", "SIMRELAY_UPLOAD_STORE_FILE")
val releaseStorePassword = releaseValue("SIMRELAY_UPLOAD_STORE_PASSWORD", "SIMRELAY_UPLOAD_STORE_PASSWORD")
val releaseKeyAlias = releaseValue("SIMRELAY_UPLOAD_KEY_ALIAS", "SIMRELAY_UPLOAD_KEY_ALIAS")
val releaseKeyPassword = releaseValue("SIMRELAY_UPLOAD_KEY_PASSWORD", "SIMRELAY_UPLOAD_KEY_PASSWORD")
val hasReleaseSigningConfig = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword
).all { !it.isNullOrBlank() }

android {
    namespace = "com.estio.simrelay"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.estio.simrelay"
        minSdk = 26
        targetSdk = 34
        versionCode = providers.gradleProperty("SIMRELAY_VERSION_CODE")
            .map(String::toInt)
            .getOrElse(1)
        versionName = providers.gradleProperty("SIMRELAY_VERSION_NAME")
            .getOrElse("1.0")
    }

    signingConfigs {
        create("releaseUpload") {
            if (hasReleaseSigningConfig) {
                storeFile = rootProject.file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseSigningConfig) {
                signingConfig = signingConfigs.getByName("releaseUpload")
            }
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    // Retrofit & OkHttp for networking
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.retrofit2:converter-gson:2.9.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.11.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Security
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // QR Code Scanning (GMS)
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}

tasks.register("printReleaseConfig") {
    group = "help"
    description = "Prints SIM Relay release version and signing configuration status."
    doLast {
        println("SIMRelay versionCode=${android.defaultConfig.versionCode}")
        println("SIMRelay versionName=${android.defaultConfig.versionName}")
        println(
            if (hasReleaseSigningConfig) {
                "Release signing: configured"
            } else {
                "Release signing: not configured; release APK/AAB will be unsigned"
            }
        )
    }
}
