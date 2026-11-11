package com.estudiodeiris.naviris

import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

class PasswordActivity : AppCompatActivity() {

    private val store by lazy {
        val key = MasterKey.Builder(this)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            // Mismo nombre de archivo de siempre: con otro, las contraseñas guardadas no se encontrarían.
            this, "cobalt_passwords", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_password)
        list = findViewById(R.id.pwList)
        findViewById<Button>(R.id.pwAdd).setOnClickListener { addDialog() }
        render()
    }

    // clave = siteusername  |  valor = contraseña (cifrada por EncryptedSharedPreferences)
    private fun entries(): List<Triple<String, String, String>> =
        store.all.keys.sorted().map { k ->
            val obj = JSONObject(k)
            Triple(k, obj.optString("site"), obj.optString("user"))
        }

    private fun render() {
        list.removeAllViews()
        val es = entries()
        if (es.isEmpty()) {
            val tv = TextView(this).apply {
                text = "Aún no has guardado contraseñas.\nPulsa «Añadir» para empezar."
                setTextColor(0xFF8B8D94.toInt()); textSize = 13f; gravity = Gravity.CENTER
                setPadding(0, 60, 0, 0)
            }
            list.addView(tv); return
        }
        for ((key, site, user) in es) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(28, 26, 28, 26)
                setBackgroundColor(0xFF16161A.toInt())
            }
            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            }
            info.addView(TextView(this).apply { text = site; setTextColor(0xFFECECEF.toInt()); textSize = 14f })
            info.addView(TextView(this).apply { text = if (user.isNotEmpty()) user else "••••••••"; setTextColor(0xFF8B8D94.toInt()); textSize = 12f })
            val reveal = Button(this).apply { text = "Ver"; textSize = 12f; setOnClickListener { authAndReveal(key, site) } }
            val del = Button(this).apply {
                text = "✕"; textSize = 12f; setTextColor(0xFFE5484D.toInt())
                setOnClickListener { store.edit().remove(key).apply(); render() }
            }
            row.addView(info); row.addView(reveal); row.addView(del)
            list.addView(row)
            list.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(-1, 2); setBackgroundColor(0xFF232327.toInt()) })
        }
    }

    private fun addDialog() {
        val pad = 40
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad / 2, pad, 0) }
        val site = EditText(this).apply { hint = "Sitio (ej. github.com)"; setSingleLine() }
        val user = EditText(this).apply { hint = "Usuario o correo"; setSingleLine() }
        val pass = EditText(this).apply { hint = "Contraseña"; inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD }
        box.addView(site); box.addView(user); box.addView(pass)
        AlertDialog.Builder(this)
            .setTitle("Nueva contraseña")
            .setView(box)
            .setPositiveButton("Guardar") { _, _ ->
                val s = site.text.toString().trim()
                val p = pass.text.toString()
                if (s.isEmpty() || p.isEmpty()) { toast("Falta el sitio o la contraseña"); return@setPositiveButton }
                val key = JSONObject().put("site", s).put("user", user.text.toString().trim()).toString()
                store.edit().putString(key, p).apply()
                render(); toast("Guardada y cifrada")
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun authAndReveal(key: String, site: String) {
        val bm = BiometricManager.from(this)
        val can = bm.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        )
        if (can != BiometricManager.BIOMETRIC_SUCCESS) {
            // Sin biometría/PIN configurado: mostramos igualmente (ya está cifrada en disco)
            showPassword(key); return
        }
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    showPassword(key)
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    toast("Verificación cancelada")
                }
            })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Verifica tu identidad")
            .setSubtitle("Ver la contraseña de $site")
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
            .build()
        prompt.authenticate(info)
    }

    private fun showPassword(key: String) {
        val pw = store.getString(key, null) ?: return
        val tv = TextView(this).apply { text = pw; setTextIsSelectable(true); textSize = 16f; setPadding(50, 40, 50, 10) }
        AlertDialog.Builder(this)
            .setTitle("Contraseña")
            .setView(tv)
            .setPositiveButton("Copiar") { _, _ ->
                val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText("Naviris", pw))
                toast("Copiada")
            }
            .setNegativeButton("Cerrar", null)
            .show()
    }

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()
}
