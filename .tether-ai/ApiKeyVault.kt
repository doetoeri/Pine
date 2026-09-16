package com.tether.focus

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores the user-provided Gemini API key encrypted with Android Keystore. */
class ApiKeyVault(context: Context) {
    private val prefs = context.getSharedPreferences("tether_secrets", Context.MODE_PRIVATE)
    private val alias = "tether_gemini_api_key_v1"

    fun save(value: String) {
        val clean = value.trim()
        if (clean.isEmpty()) {
            clear()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(clean.toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString("api_key_cipher", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("api_key_iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }

    fun load(): String {
        val encryptedB64 = prefs.getString("api_key_cipher", null) ?: return ""
        val ivB64 = prefs.getString("api_key_iv", null) ?: return ""
        return runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val iv = Base64.decode(ivB64, Base64.NO_WRAP)
            val encrypted = Base64.decode(encryptedB64, Base64.NO_WRAP)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(encrypted), Charsets.UTF_8)
        }.getOrElse {
            clear()
            ""
        }
    }

    fun clear() {
        prefs.edit().remove("api_key_cipher").remove("api_key_iv").apply()
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }
}
