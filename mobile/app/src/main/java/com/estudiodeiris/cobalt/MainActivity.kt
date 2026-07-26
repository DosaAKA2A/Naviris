package com.estudiodeiris.cobalt

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
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
    private lateinit var urlBar: AutoCompleteTextView
    private lateinit var progress: ProgressBar
    private lateinit var btnTabs: Button
    private lateinit var btnBookmark: ImageButton
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
        btnBookmark = findViewById(R.id.btnBookmark)
        findBar = findViewById(R.id.findBar)
        findInput = findViewById(R.id.findInput)
        findCount = findViewById(R.id.findCount)
        adblock = prefs.getBoolean("adblock", true)

        findViewById<ImageButton>(R.id.btnBack).setOnClickListener { if (web.canGoBack()) web.goBack() }
        findViewById<ImageButton>(R.id.btnFwd).setOnClickListener { if (web.canGoForward()) web.goForward() }
        findViewById<ImageButton>(R.id.btnReload).setOnClickListener { web.reload() }
        findViewById<ImageButton>(R.id.btnMenu).setOnClickListener { showMenu(it) }
        btnTabs.setOnClickListener { showTabs() }
        btnBookmark.setOnClickListener { toggleBookmark() }
        btnBookmark.setOnLongClickListener { showBookmarks(); true }

        urlBar.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_GO || event?.keyCode == KeyEvent.KEYCODE_ENTER) {
                go(urlBar.text.toString()); true
            } else false
        }
        // Sugerencias inteligentes: historial + marcadores, filtrado por "contiene"
        refreshSuggestions()
        urlBar.setOnItemClickListener { _, view, _, _ ->
            val url = (view as TextView).text.toString().substringAfterLast('\n')
            urlBar.dismissDropDown()
            web.loadUrl(url); hideKeyboard(); web.requestFocus()
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

        // Comprobación automática una vez al día: solo avisa si hay novedad.
        // Antes había que acordarse de buscarla a mano en el menú.
        val ahora = System.currentTimeMillis()
        if (ahora - prefs.getLong("lastUpdCheck", 0L) > 86_400_000L) {
            prefs.edit().putLong("lastUpdCheck", ahora).apply()
            urlBar.postDelayed({ checkUpdate(true) }, 4000)
        }
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
        // Pestaña nueva → el foco va directo a la barra, como en el escritorio:
        // se puede escribir la dirección sin tocar nada más.
        if (url == HOME) urlBar.post {
            urlBar.requestFocus()
            (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .showSoftInput(urlBar, InputMethodManager.SHOW_IMPLICIT)
        }
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
        updateBookmarkBtn()
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
                // Enlace propio del hub: tocar la versión busca actualizaciones
                // (esquema propio en vez de exponer un JavascriptInterface al que
                // podría llamar cualquier web abierta en el navegador).
                if (url.startsWith("naviris://update")) { checkUpdate(false); return true }
                return !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://"))
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                if (view == tabs.getOrNull(current)?.web && url != null && url != HOME) urlBar.setText(url)
                if (view == tabs.getOrNull(current)?.web) updateBookmarkBtn()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                recordHistory(url, view?.title)
                if (view == tabs.getOrNull(current)?.web) updateBookmarkBtn()
                // La versión se pinta en el hub para que esté siempre a la vista
                if (url == HOME) view?.evaluateJavascript(
                    "(function(){var e=document.getElementById('ver');if(e)e.textContent='Naviris ${appVersion()}';})()", null
                )
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
                val dlId = (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                recordDownload(name, dlId)
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
        urlBar.dismissDropDown()
        web.loadUrl(url)
        hideKeyboard()
        web.requestFocus()
    }

    // ---------- Menú ----------

    private fun showMenu(anchor: View) {
        val pm = PopupMenu(this, anchor)
        pm.menu.add("Inicio")
        pm.menu.add("Nueva pestaña")
        pm.menu.add("Marcadores")
        pm.menu.add("Historial")
        pm.menu.add("Descargas")
        pm.menu.add("Rat Tool — descargar vídeo")
        pm.menu.add("Contraseñas")
        pm.menu.add("Buscar en página")
        pm.menu.add(if (tab.desktopMode) "Modo escritorio: ON" else "Modo escritorio: OFF")
        pm.menu.add(if (adblock) "Bloqueo de anuncios: ON" else "Bloqueo de anuncios: OFF")
        pm.menu.add("Compartir")
        // La versión va en el propio texto: antes había que entrar en "Acerca de"
        // para saber cuál tenías, y quien venía de la v1 (llamada "Cobalt") no
        // tenía ninguna de estas dos entradas.
        pm.menu.add("Buscar actualización · tienes la ${appVersion()}")
        pm.menu.add("Acerca de Naviris")
        pm.setOnMenuItemClickListener { item ->
            val title = item.title.toString()
            when {
                title == "Inicio" -> web.loadUrl(HOME)
                title == "Nueva pestaña" -> newTab(HOME)
                title == "Marcadores" -> showBookmarks()
                title == "Historial" -> showHistory()
                title == "Descargas" -> showDownloads()
                title.startsWith("Rat Tool") -> openRatTool()
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
                title.startsWith("Buscar actualización") -> checkUpdate(false)
                title.startsWith("Acerca de") -> showAbout()
            }
            true
        }
        pm.show()
    }

    // ---------- Marcadores (mismo ciclo que el escritorio: vacío → lleno → quitar en rojo) ----------

    private fun currentBookmarkable(): String? {
        val u = web.url
        return if (u == null || u == HOME || u.startsWith("file://")) null else u
    }

    private fun isBookmarked(url: String) = prefs.getStringSet("bookmarks", emptySet())!!.contains(url)

    private fun updateBookmarkBtn() {
        val u = currentBookmarkable()
        val saved = u != null && isBookmarked(u)
        btnBookmark.setImageResource(if (saved) R.drawable.ic_bookmark_added else R.drawable.ic_bookmark_add)
        btnBookmark.imageTintList = ColorStateList.valueOf(getColor(if (saved) R.color.accent else R.color.muted))
    }

    private fun toggleBookmark() {
        val u = currentBookmarkable() ?: run { toast("Abre una página primero"); return }
        val set = prefs.getStringSet("bookmarks", emptySet())!!.toMutableSet()
        if (set.contains(u)) {
            // Quitar: cinta con el menos en ROJO mientras se decide, como en escritorio
            btnBookmark.setImageResource(R.drawable.ic_bookmark_remove)
            btnBookmark.imageTintList = ColorStateList.valueOf(getColor(R.color.danger))
            AlertDialog.Builder(this)
                .setTitle("Quitar marcador")
                .setMessage(u)
                .setPositiveButton("Quitar") { _, _ ->
                    set.remove(u)
                    prefs.edit().putStringSet("bookmarks", set).apply()
                    toast("Marcador quitado"); refreshSuggestions(); updateBookmarkBtn()
                }
                .setNegativeButton("Cancelar") { _, _ -> updateBookmarkBtn() }
                .setOnCancelListener { updateBookmarkBtn() }
                .show()
        } else {
            set.add(u)
            prefs.edit().putStringSet("bookmarks", set).apply()
            toast("Marcador guardado"); refreshSuggestions(); updateBookmarkBtn()
        }
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
            refreshSuggestions()
        } catch (e: Exception) { /* historial corrupto: se regenera solo */ }
    }

    // ---------- Sugerencias inteligentes de la barra (historial + marcadores) ----------

    private inner class SuggestAdapter(private val all: List<String>) :
        ArrayAdapter<String>(this@MainActivity, R.layout.suggest_item, all.toMutableList()) {
        override fun getFilter(): Filter = object : Filter() {
            override fun performFiltering(c: CharSequence?): FilterResults {
                val q = c?.toString()?.lowercase()?.trim() ?: ""
                val res = if (q.isEmpty()) all.take(8) else all.filter { it.lowercase().contains(q) }.take(8)
                return FilterResults().apply { values = res; count = res.size }
            }
            @Suppress("UNCHECKED_CAST")
            override fun publishResults(c: CharSequence?, r: FilterResults) {
                clear()
                addAll(r.values as? List<String> ?: emptyList())
                if (r.count > 0) notifyDataSetChanged() else notifyDataSetInvalidated()
            }
        }
    }

    private fun refreshSuggestions() {
        val items = LinkedHashSet<String>()
        for (u in prefs.getStringSet("bookmarks", emptySet())!!) items.add("★ ${Uri.parse(u).host ?: u}\n$u")
        try {
            val arr = JSONArray(prefs.getString("history", "[]"))
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val u = o.optString("url"); if (u.isBlank()) continue
                items.add("${o.optString("title").ifBlank { u }}\n$u")
            }
        } catch (e: Exception) { /* nada */ }
        urlBar.setAdapter(SuggestAdapter(items.toList()))
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

    // ---------- Descargas: solo lo descargado desde Naviris, por tipo y fecha ----------

    private fun recordDownload(name: String, id: Long) {
        try {
            val arr = JSONArray(prefs.getString("downloads", "[]"))
            val out = JSONArray().put(JSONObject().put("n", name).put("t", System.currentTimeMillis()).put("id", id))
            for (i in 0 until minOf(arr.length(), 499)) out.put(arr.getJSONObject(i))
            prefs.edit().putString("downloads", out.toString()).apply()
        } catch (e: Exception) { /* nada */ }
    }

    private fun typeOf(name: String): String {
        val n = name.lowercase()
        return when {
            Regex("\\.(png|jpe?g|gif|webp|bmp|svg|avif)$").containsMatchIn(n) -> "Imagen"
            Regex("\\.(mp4|webm|mkv|mov|avi|m4v)$").containsMatchIn(n) -> "Vídeo"
            Regex("\\.(mp3|wav|m4a|flac|ogg|opus|aac)$").containsMatchIn(n) -> "Música"
            Regex("\\.(pdf|docx?|xlsx?|pptx?|txt|csv|epub)$").containsMatchIn(n) -> "Documento"
            Regex("\\.(zip|rar|7z|tar|gz)$").containsMatchIn(n) -> "Comprimido"
            Regex("\\.(apk|exe|msi)$").containsMatchIn(n) -> "Programa"
            else -> "Archivo"
        }
    }

    private fun groupOf(t: Long): String {
        val today = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
        }.timeInMillis
        return when {
            t >= today -> "Hoy"
            today - t < 86400000L -> "Ayer"
            today - t < 7 * 86400000L -> "Esta semana"
            else -> java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale("es"))
                .format(java.util.Date(t)).replaceFirstChar { it.uppercase() }
        }
    }

    private fun showDownloads() {
        val arr = try { JSONArray(prefs.getString("downloads", "[]")) } catch (e: Exception) { JSONArray() }
        if (arr.length() == 0) {
            AlertDialog.Builder(this)
                .setTitle("Descargas")
                .setMessage("Aún no has descargado nada desde Naviris.")
                .setNeutralButton("Carpeta del sistema") { _, _ -> openDownloads() }
                .setPositiveButton("OK", null)
                .show()
            return
        }
        val labels = ArrayList<String>(arr.length()); val ids = ArrayList<Long>(arr.length())
        val fecha = java.text.SimpleDateFormat("dd/MM HH:mm", java.util.Locale("es"))
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val n = o.optString("n"); val t = o.optLong("t")
            labels.add("$n\n${groupOf(t)} · ${fecha.format(java.util.Date(t))} · ${typeOf(n)}")
            ids.add(o.optLong("id", -1))
        }
        AlertDialog.Builder(this)
            .setTitle("Descargas de Naviris")
            .setItems(labels.toTypedArray()) { _, i -> openDownloadedFile(ids[i]) }
            .setNeutralButton("Carpeta del sistema") { _, _ -> openDownloads() }
            .setNegativeButton("Cerrar", null)
            .show()
    }

    private fun openDownloadedFile(id: Long) {
        if (id >= 0) {
            try {
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val uri = dm.getUriForDownloadedFile(id)
                if (uri != null) {
                    val mime = dm.getMimeTypeForDownloadedFile(id) ?: "*/*"
                    startActivity(Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, mime); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    })
                    return
                }
            } catch (e: Exception) { /* cae a la carpeta */ }
        }
        toast("Ese archivo ya no está disponible")
        openDownloads()
    }

    private fun openDownloads() {
        try { startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) }
        catch (e: Exception) { toast("No se pudo abrir Descargas") }
    }

    // ---------- Rat Tool: descargar vídeo/audio de la página actual ----------

    private fun openRatTool() {
        val barUrl = web.url
        if (barUrl == null || barUrl == HOME || barUrl.startsWith("file://")) { toast("Abre un vídeo primero"); return }
        // En sitios de una sola página (YouTube móvil) la barra puede ir por
        // detrás del vídeo que se está viendo: manda la URL canónica del DOM.
        web.evaluateJavascript(
            "(function(){var c=document.querySelector('link[rel=\"canonical\"]');" +
                "return (c&&c.href)||location.href;})()"
        ) { raw ->
            val canon = (raw ?: "").trim().trim('"').ifBlank { barUrl }
            val pageUrl = if (RatTool.videoId(canon) != null) canon else barUrl
            ratStart(pageUrl)
        }
    }

    private fun ratStart(pageUrl: String) {
        if (RatTool.isYouTube(pageUrl)) {
            toast("Rat Tool: obteniendo formatos…")
            Thread {
                try {
                    val info = RatTool.fetchYouTube(pageUrl)
                    runOnUiThread { showRatOptions(info, pageUrl) }
                } catch (e: Exception) {
                    val msg = (e.message ?: "").take(90)
                    runOnUiThread {
                        toast(
                            if (msg.contains("not accepted", true) || msg.contains("ParsingException", true))
                                "No reconozco este enlace de YouTube. Abre el vídeo en su propia página."
                            else "No se pudo extraer: $msg"
                        )
                    }
                }
            }.start()
            return
        }
        // Genérico (TikTok/X/Instagram/etc.): vídeo de la propia página si su URL
        // es directa (og:video o <video> src); los streams blob/m3u8 no se pueden
        // guardar sin extractor propio del sitio.
        web.evaluateJavascript(
            "(function(){var v=document.querySelector('video');var s=v&&(v.currentSrc||v.src)||'';" +
                "if(!s||s.indexOf('blob:')===0){var m=document.querySelector('meta[property=\"og:video:secure_url\"],meta[property=\"og:video:url\"],meta[property=\"og:video\"]');" +
                "s=(m&&m.content)||s;}return s;})()"
        ) { raw ->
            val src = (raw ?: "").trim().trim('"')
            when {
                src.startsWith("https://") && !src.contains(".m3u8") && !src.contains(".mpd") -> {
                    val host = Uri.parse(pageUrl).host?.removePrefix("www.") ?: "video"
                    AlertDialog.Builder(this)
                        .setTitle("Rat Tool")
                        .setMessage("Vídeo detectado en $host. ¿Descargar MP4?")
                        .setPositiveButton("Descargar") { _, _ ->
                            ratDownload(src, "$host ${System.currentTimeMillis() / 1000}", "mp4", pageUrl)
                        }
                        .setNegativeButton("Cancelar", null)
                        .show()
                }
                src.startsWith("blob:") || src.contains(".m3u8") || src.contains(".mpd") ->
                    toast("Este sitio emite en streaming: no se puede guardar directo")
                else -> toast("No se detectó ningún vídeo en la página")
            }
        }
    }

    private fun showRatOptions(info: RatTool.Info, pageUrl: String) {
        val labels = info.options.map { it.label }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(info.title)
            .setItems(labels) { _, i ->
                val o = info.options[i]
                ratDownload(o.url, info.title, o.fileExt, pageUrl)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun ratDownload(mediaUrl: String, title: String, ext: String, referer: String?) {
        try {
            val safe = title.replace(Regex("[\\\\/:*?\"<>|]+"), "_").take(80).trim().ifBlank { "video" }
            val name = "$safe.$ext"
            val req = DownloadManager.Request(Uri.parse(mediaUrl)).apply {
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                setTitle(name)
                addRequestHeader("User-Agent", web.settings.userAgentString)
                CookieManager.getInstance().getCookie(mediaUrl)?.let { addRequestHeader("Cookie", it) }
                referer?.let { addRequestHeader("Referer", it) }
            }
            val dlId = (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            recordDownload(name, dlId)
            toast("Descargando $name")
        } catch (e: Exception) { toast("No se pudo descargar") }
    }

    // ---------- Actualización ----------

    private fun appVersion(): String =
        try { packageManager.getPackageInfo(packageName, 0).versionName ?: "?" } catch (e: Exception) { "?" }

    /* ¿Está esta instalación firmada con el certificado oficial? Las primeras
       versiones (la que se llamaba "Cobalt") salieron firmadas en modo debug, y
       Android RECHAZA actualizarlas con un APK de otra firma: hay que
       desinstalar antes. Sin este aviso el usuario solo ve "no se instaló". */
    private val RELEASE_CERT_SHA256 = "bd29a7d9f4e4125bdbdfa7ec35a40e2a5be9529763ac0632903e4843dcd87be8"

    private fun signedOfficially(): Boolean = try {
        val flag = if (android.os.Build.VERSION.SDK_INT >= 28)
            android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES
        else @Suppress("DEPRECATION") android.content.pm.PackageManager.GET_SIGNATURES
        val info = packageManager.getPackageInfo(packageName, flag)
        val sigs = if (android.os.Build.VERSION.SDK_INT >= 28)
            info.signingInfo?.apkContentsSigners else @Suppress("DEPRECATION") info.signatures
        val md = java.security.MessageDigest.getInstance("SHA-256")
        sigs?.any { s ->
            md.reset()
            md.digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
                .equals(RELEASE_CERT_SHA256, true)
        } ?: false
    } catch (e: Exception) { true } // ante la duda no se alarma al usuario

    /** silent = comprobación automática: solo habla si hay novedad. */
    private fun checkUpdate(silent: Boolean) {
        if (!silent) toast("Buscando actualización…")
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
                runOnUiThread { onUpdateResult(tag, apkUrl, apkName, silent) }
            } catch (e: Exception) {
                runOnUiThread { if (!silent) toast("No se pudo comprobar (sin conexión o sin releases)") }
            }
        }.start()
    }

    private fun onUpdateResult(tag: String, apkUrl: String?, apkName: String?, silent: Boolean = false) {
        val cur = appVersion()
        if (silent && apkUrl != null && apkName != null) {
            val remoteV = Regex("\\d+(\\.\\d+)+").find(apkName)?.value ?: tag
            if (compareVersions(remoteV, cur) <= 0) return // al día: no molestar
        }
        if (apkUrl == null || apkName == null) {
            if (silent) return
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
        val aviso = if (signedOfficially()) ""
        else "\n\nAVISO: tu instalación es de una versión antigua firmada de otra " +
            "forma, así que Android no dejará instalar la nueva encima. Desinstala " +
            "esta app primero y luego abre el APK descargado (se perderán los " +
            "marcadores y contraseñas guardados en ella)."
        AlertDialog.Builder(this)
            .setTitle("Actualización disponible")
            .setMessage("Hay una nueva versión: $remote (tienes la $cur).\n¿Descargar $apkName?$aviso")
            .setPositiveButton("Descargar") { _, _ ->
                try {
                    val req = DownloadManager.Request(Uri.parse(apkUrl)).apply {
                        setMimeType("application/vnd.android.package-archive")
                        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, apkName)
                        setTitle(apkName)
                    }
                    val dlId = (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                    recordDownload(apkName, dlId)
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
        AlertDialog.Builder(this)
            .setTitle("Naviris para Android")
            .setMessage("Versión ${appVersion()}\nEstudio de Iris\n\nNavegador con bloqueo de anuncios, pestañas, marcadores con un toque, sugerencias en la barra, Rat Tool (descarga de vídeo/audio), descargas propias, historial y contraseñas.")
            .setPositiveButton("OK", null)
            .setNeutralButton("Buscar actualización") { _, _ -> checkUpdate(false) }
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
