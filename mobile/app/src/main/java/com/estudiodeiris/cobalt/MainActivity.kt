package com.estudiodeiris.cobalt

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.text.Editable
import android.text.TextWatcher
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.*
import android.widget.*
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private class Tab(val web: WebView) {
        var title: String = "Nueva pestaña"
        var desktopMode = false
    }

    private lateinit var container: FrameLayout
    private lateinit var urlBar: EditText
    private lateinit var progress: ProgressBar
    private lateinit var btnTabs: Button
    private lateinit var findBar: LinearLayout
    private lateinit var findInput: EditText
    private lateinit var findCount: TextView

    private val HOME = "file:///android_asset/hub.html"
    private val DESKTOP_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    private val REPO_API = "https://api.github.com/repos/DosaAKA2A/Naviris/releases/latest"

    private val prefs by lazy { getSharedPreferences("cobalt", Context.MODE_PRIVATE) }
    private var adblock = true

    private val tabs = mutableListOf<Tab>()
    private var current = 0
    private val tab get() = tabs[current]
    private val web get() = tab.web

    private val adHosts = listOf(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
        "google-analytics.com", "googletagservices.com", "2mdn.net", "adnxs.com", "adsafeprotected.com",
        "amazon-adsystem.com", "criteo.com", "criteo.net", "taboola.com", "outbrain.com", "pubmatic.com",
        "rubiconproject.com", "openx.net", "scorecardresearch.com", "quantserve.com", "zedo.com",
        "popads.net", "propellerads.com", "adroll.com", "moatads.com", "adform.net", "smartadserver.com",
        "teads.tv", "exoclick.com", "doubleverify.com", "applovin.com", "mopub.com", "inmobi.com",
        "mgid.com", "revcontent.com", "casalemedia.com", "adsrvr.org", "hotjar.com", "mouseflow.com"
    )
    private val ytAdPaths = listOf("/pagead/", "/api/stats/ads", "/ptracking", "/get_midroll_info")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        container = findViewById(R.id.webContainer)
        urlBar = findViewById(R.id.urlBar)
        progress = findViewById(R.id.progress)
        btnTabs = findViewById(R.id.btnTabs)
        findBar = findViewById(R.id.findBar)
        findInput = findViewById(R.id.findInput)
        findCount = findViewById(R.id.findCount)
        adblock = prefs.getBoolean("adblock", true)

        findViewById<Button>(R.id.btnBack).setOnClickListener { if (web.canGoBack()) web.goBack() }
        findViewById<Button>(R.id.btnFwd).setOnClickListener { if (web.canGoForward()) web.goForward() }
        findViewById<Button>(R.id.btnReload).setOnClickListener { web.reload() }
        findViewById<Button>(R.id.btnMenu).setOnClickListener { showMenu(it) }
        btnTabs.setOnClickListener { showTabs() }

        urlBar.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_GO || event?.keyCode == KeyEvent.KEYCODE_ENTER) {
                go(urlBar.text.toString()); true
            } else false
        }

        setupFindBar()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    findBar.visibility == View.VISIBLE -> closeFindBar()
                    web.canGoBack() -> web.goBack()
                    tabs.size > 1 -> closeTab(current)
                    else -> finish()
                }
            }
        })

        val data = intent?.data?.toString()
        newTab(if (!data.isNullOrBlank()) data else HOME)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val data = intent.data?.toString()
        if (!data.isNullOrBlank()) newTab(data)
    }

    // ---------- Pestañas ----------

    private fun newTab(url: String) {
        val wv = WebView(this)
        wv.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        )
        val t = Tab(wv)
        setupWebView(t)
        container.addView(wv)
        tabs.add(t)
        switchTab(tabs.size - 1)
        wv.loadUrl(url)
    }

    private fun switchTab(index: Int) {
        if (index !in tabs.indices) return
        current = index
        for ((i, t) in tabs.withIndex()) t.web.visibility = if (i == index) View.VISIBLE else View.GONE
        val url = web.url
        urlBar.setText(if (url == null || url == HOME) "" else url)
        progress.visibility = View.GONE
        closeFindBar()
        updateTabsBtn()
    }

    private fun closeTab(index: Int) {
        if (index !in tabs.indices) return
        val t = tabs.removeAt(index)
        container.removeView(t.web)
        t.web.destroy()
        if (tabs.isEmpty()) { newTab(HOME); return }
        switchTab(if (index <= current && current > 0) current - 1 else current.coerceAtMost(tabs.size - 1))
    }

    private fun updateTabsBtn() { btnTabs.text = tabs.size.toString() }

    private fun showTabs() {
        val labels = tabs.mapIndexed { i, t ->
            (if (i == current) "● " else "") + (t.title.ifBlank { t.web.url ?: "Nueva pestaña" })
        }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("Pestañas")
            .setItems(labels) { _, i -> switchTab(i) }
            .setPositiveButton("Nueva pestaña") { _, _ -> newTab(HOME) }
            .setNeutralButton("Cerrar actual") { _, _ -> closeTab(current) }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // ---------- WebView ----------

    private fun setupWebView(t: Tab) {
        val wv = t.web
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)

        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (adblock) {
                    val host = request.url.host ?: ""
                    val path = request.url.path ?: ""
                    val isAd = adHosts.any { host == it || host.endsWith(".$it") } ||
                            ytAdPaths.any { path.contains(it) }
                    if (isAd) {
                        return WebResourceResponse("text/plain", "utf-8", java.io.ByteArrayInputStream(ByteArray(0)))
                    }
                }
                return null
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                return !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://"))
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                if (view == tabs.getOrNull(current)?.web && url != null && url != HOME) urlBar.setText(url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                recordHistory(url, view?.title)
                if ((url ?: "").contains("youtube.com")) {
                    view?.evaluateJavascript(
                        "(function(){if(window.__cbYT)return;window.__cbYT=1;setInterval(function(){try{var p=document.querySelector('.html5-video-player');var v=document.querySelector('video');if(p&&p.classList.contains('ad-showing')&&v){v.muted=true;if(isFinite(v.duration))v.currentTime=v.duration;}var b=document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button');if(b)b.click();}catch(e){}},400);})();",
                        null
                    )
                }
            }
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (view != tabs.getOrNull(current)?.web) return
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }

            override fun onReceivedTitle(view: WebView?, title: String?) {
                if (!title.isNullOrBlank()) { t.title = title; }
            }
        }

        wv.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            try {
                val name = URLUtil.guessFileName(url, contentDisposition, mimetype)
                val req = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimetype)
                    addRequestHeader("User-Agent", userAgent)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                    setTitle(name)
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                toast("Descargando $name")
            } catch (e: Exception) {
                toast("No se pudo descargar")
            }
        }

        wv.setFindListener { activeMatchOrdinal, numberOfMatches, _ ->
            findCount.text = if (numberOfMatches > 0) "${activeMatchOrdinal + 1}/$numberOfMatches" else "0/0"
        }
    }

    private fun go(input: String) {
        val t = input.trim()
        if (t.isEmpty()) return
        val url = when {
            t.startsWith("http://") || t.startsWith("https://") -> t
            !t.contains(" ") && t.contains(".") -> "https://$t"
            else -> "https://www.google.com/search?q=" + Uri.encode(t)
        }
        web.loadUrl(url)
        hideKeyboard()
        web.requestFocus()
    }

    // ---------- Menú ----------

    private fun showMenu(anchor: View) {
        val pm = PopupMenu(this, anchor)
        pm.menu.add("Inicio")
        pm.menu.add("Nueva pestaña")
        pm.menu.add("Añadir marcador")
        pm.menu.add("Marcadores")
        pm.menu.add("Historial")
        pm.menu.add("Descargas")
        pm.menu.add("Contraseñas")
        pm.menu.add("Buscar en página")
        pm.menu.add(if (tab.desktopMode) "Modo escritorio: ON" else "Modo escritorio: OFF")
        pm.menu.add(if (adblock) "Bloqueo de anuncios: ON" else "Bloqueo de anuncios: OFF")
        pm.menu.add("Compartir")
        pm.menu.add("Buscar actualización")
        pm.menu.add("Acerca de")
        pm.setOnMenuItemClickListener { item ->
            val title = item.title.toString()
            when {
                title == "Inicio" -> web.loadUrl(HOME)
                title == "Nueva pestaña" -> newTab(HOME)
                title == "Añadir marcador" -> addBookmark()
                title == "Marcadores" -> showBookmarks()
                title == "Historial" -> showHistory()
                title == "Descargas" -> openDownloads()
                title == "Contraseñas" -> startActivity(Intent(this, PasswordActivity::class.java))
                title == "Buscar en página" -> openFindBar()
                title.startsWith("Modo escritorio") -> toggleDesktopMode()
                title.startsWith("Bloqueo") -> {
                    adblock = !adblock
                    prefs.edit().putBoolean("adblock", adblock).apply()
                    toast(if (adblock) "Bloqueador activado" else "Bloqueador desactivado")
                    web.reload()
                }
                title == "Compartir" -> shareUrl()
                title == "Buscar actualización" -> checkUpdate()
                title == "Acerca de" -> showAbout()
            }
            true
        }
        pm.show()
    }

    // ---------- Marcadores ----------

    private fun addBookmark() {
        val url = web.url ?: return
        if (url == HOME) { toast("Abre una página primero"); return }
        val set = prefs.getStringSet("bookmarks", emptySet())!!.toMutableSet()
        set.add(url)
        prefs.edit().putStringSet("bookmarks", set).apply()
        toast("Marcador guardado")
    }

    private fun showBookmarks() {
        val urls = prefs.getStringSet("bookmarks", emptySet())!!.toList()
        if (urls.isEmpty()) { toast("No tienes marcadores"); return }
        val labels = urls.map { Uri.parse(it).host ?: it }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("Marcadores")
            .setItems(labels) { _, i -> web.loadUrl(urls[i]) }
            .setNeutralButton("Eliminar…") { _, _ -> deleteBookmarks(urls, labels) }
            .setNegativeButton("Cerrar", null)
            .show()
    }

    private fun deleteBookmarks(urls: List<String>, labels: Array<String>) {
        val checked = BooleanArray(urls.size)
        AlertDialog.Builder(this)
            .setTitle("Eliminar marcadores")
            .setMultiChoiceItems(labels, checked) { _, i, on -> checked[i] = on }
            .setPositiveButton("Eliminar") { _, _ ->
                val keep = urls.filterIndexed { i, _ -> !checked[i] }.toSet()
                prefs.edit().putStringSet("bookmarks", keep).apply()
                toast("Marcadores actualizados")
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // ---------- Historial ----------

    private fun recordHistory(url: String?, title: String?) {
        if (url.isNullOrBlank() || url == HOME || url.startsWith("file://")) return
        try {
            val arr = JSONArray(prefs.getString("history", "[]"))
            if (arr.length() > 0 && arr.getJSONObject(0).optString("url") == url) return
            val entry = JSONObject().put("url", url).put("title", title ?: url)
            val out = JSONArray().put(entry)
            for (i in 0 until minOf(arr.length(), 299)) out.put(arr.getJSONObject(i))
            prefs.edit().putString("history", out.toString()).apply()
        } catch (e: Exception) { /* historial corrupto: se regenera solo */ }
    }

    private fun showHistory() {
        val arr = try { JSONArray(prefs.getString("history", "[]")) } catch (e: Exception) { JSONArray() }
        if (arr.length() == 0) { toast("El historial está vacío"); return }
        val urls = ArrayList<String>(arr.length())
        val labels = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            urls.add(o.optString("url"))
            val host = Uri.parse(o.optString("url")).host ?: ""
            labels.add(o.optString("title").ifBlank { o.optString("url") } + if (host.isNotEmpty()) "\n$host" else "")
        }
        AlertDialog.Builder(this)
            .setTitle("Historial")
            .setItems(labels.toTypedArray()) { _, i -> web.loadUrl(urls[i]) }
            .setNeutralButton("Borrar historial") { _, _ ->
                prefs.edit().remove("history").apply()
                toast("Historial borrado")
            }
            .setNegativeButton("Cerrar", null)
            .show()
    }

    // ---------- Buscar en página ----------

    private fun setupFindBar() {
        findInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                val q = s?.toString() ?: ""
                if (q.isEmpty()) { web.clearMatches(); findCount.text = "0/0" } else web.findAllAsync(q)
            }
        })
        findInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) { web.findNext(true); true } else false
        }
        findViewById<Button>(R.id.findNext).setOnClickListener { web.findNext(true) }
        findViewById<Button>(R.id.findPrev).setOnClickListener { web.findNext(false) }
        findViewById<Button>(R.id.findClose).setOnClickListener { closeFindBar() }
    }

    private fun openFindBar() {
        findBar.visibility = View.VISIBLE
        findInput.requestFocus()
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .showSoftInput(findInput, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun closeFindBar() {
        if (findBar.visibility != View.VISIBLE) return
        findBar.visibility = View.GONE
        findInput.setText("")
        try { web.clearMatches() } catch (e: Exception) {}
        hideKeyboard()
    }

    // ---------- Modo escritorio ----------

    private fun toggleDesktopMode() {
        tab.desktopMode = !tab.desktopMode
        web.settings.userAgentString = if (tab.desktopMode) DESKTOP_UA else null
        web.settings.loadWithOverviewMode = true
        web.settings.useWideViewPort = true
        toast(if (tab.desktopMode) "Modo escritorio activado" else "Modo escritorio desactivado")
        web.reload()
    }

    // ---------- Descargas ----------

    private fun openDownloads() {
        try { startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) }
        catch (e: Exception) { toast("No se pudo abrir Descargas") }
    }

    // ---------- Actualización ----------

    private fun checkUpdate() {
        toast("Buscando actualización…")
        Thread {
            try {
                val conn = URL(REPO_API).openConnection() as HttpURLConnection
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                conn.setRequestProperty("User-Agent", "Naviris-Android")
                conn.setRequestProperty("Accept", "application/vnd.github+json")
                val body = conn.inputStream.bufferedReader().readText()
                conn.disconnect()
                val json = JSONObject(body)
                val tag = json.optString("tag_name").removePrefix("v")
                val assets = json.optJSONArray("assets") ?: JSONArray()
                var apkUrl: String? = null
                var apkName: String? = null
                for (i in 0 until assets.length()) {
                    val a = assets.getJSONObject(i)
                    if (a.optString("name").endsWith(".apk")) {
                        apkUrl = a.optString("browser_download_url")
                        apkName = a.optString("name")
                        break
                    }
                }
                runOnUiThread { onUpdateResult(tag, apkUrl, apkName) }
            } catch (e: Exception) {
                runOnUiThread { toast("No se pudo comprobar (sin conexión o sin releases)") }
            }
        }.start()
    }

    private fun onUpdateResult(tag: String, apkUrl: String?, apkName: String?) {
        val cur = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "0" } catch (e: Exception) { "0" }
        if (apkUrl == null || apkName == null) {
            AlertDialog.Builder(this)
                .setTitle("Buscar actualización")
                .setMessage(
                    if (tag.isEmpty()) "No hay releases publicadas todavía."
                    else "La última release ($tag) no incluye APK para Android.\nTu versión: $cur"
                )
                .setPositiveButton("OK", null)
                .show()
            return
        }
        // La versión del APK viene en el nombre del asset (Naviris-X.Y.Z.apk); el tag es el de escritorio
        val remote = Regex("\\d+(\\.\\d+)+").find(apkName)?.value ?: tag
        if (compareVersions(remote, cur) <= 0) {
            AlertDialog.Builder(this)
                .setTitle("Estás al día")
                .setMessage("Naviris $cur es la versión más reciente para Android.")
                .setPositiveButton("OK", null)
                .show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Actualización disponible")
            .setMessage("Hay una nueva versión: $remote (tienes la $cur).\n¿Descargar $apkName?")
            .setPositiveButton("Descargar") { _, _ ->
                try {
                    val req = DownloadManager.Request(Uri.parse(apkUrl)).apply {
                        setMimeType("application/vnd.android.package-archive")
                        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, apkName)
                        setTitle(apkName)
                    }
                    (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                    toast("Descargando $apkName. Ábrelo desde las notificaciones para instalar.")
                } catch (e: Exception) { toast("No se pudo descargar") }
            }
            .setNegativeButton("Ahora no", null)
            .show()
    }

    private fun compareVersions(a: String, b: String): Int {
        val pa = a.split(".").map { it.toIntOrNull() ?: 0 }
        val pb = b.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val d = (pa.getOrNull(i) ?: 0) - (pb.getOrNull(i) ?: 0)
            if (d != 0) return d
        }
        return 0
    }

    // ---------- Varios ----------

    private fun showAbout() {
        val cur = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "?" } catch (e: Exception) { "?" }
        AlertDialog.Builder(this)
            .setTitle("Naviris para Android")
            .setMessage("Versión $cur\nEstudio de Iris\n\nNavegador con bloqueo de anuncios, pestañas, marcadores, historial y contraseñas.")
            .setPositiveButton("OK", null)
            .setNeutralButton("Buscar actualización") { _, _ -> checkUpdate() }
            .show()
    }

    private fun shareUrl() {
        val url = web.url ?: return
        val i = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url)
        }
        startActivity(Intent.createChooser(i, "Compartir enlace"))
    }

    private fun hideKeyboard() {
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(urlBar.windowToken, 0)
    }

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()
}
