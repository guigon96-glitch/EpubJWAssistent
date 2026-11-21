package com.criadordeepub.leitor.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.Editable
import android.text.TextWatcher
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import com.criadordeepub.leitor.Aparencia
import com.criadordeepub.leitor.Library
import com.criadordeepub.leitor.Prefs
import com.criadordeepub.leitor.R
import com.criadordeepub.leitor.epub.EpubParser
import com.criadordeepub.leitor.epub.ReaderHtmlBuilder
import com.criadordeepub.leitor.epub.TocEntry
import com.google.android.material.appbar.MaterialToolbar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.jsoup.Jsoup
import java.io.File

class ReaderActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_EMAIL = "email"
        const val EXTRA_ID = "id"
        const val EXTRA_TITLE = "titulo"
        private val ZOOMS = listOf(80, 90, 100, 110, 120, 130, 140, 150, 160, 175, 190, 205, 220, 240, 260, 285, 310, 340, 370, 400)
    }

    private lateinit var web: WebView
    private lateinit var toolbar: MaterialToolbar
    private lateinit var posKey: String
    private var toc: List<TocEntry> = emptyList()
    private var uiVisible = true
    private lateinit var ap: Aparencia
    private var apresentacao = false
    private lateinit var marcasFile: File

    // busca
    private lateinit var searchBar: View
    private lateinit var searchText: EditText
    private lateinit var searchCount: TextView

    // cronômetro
    private lateinit var timerView: TextView
    private var timerRunning = false
    private var timerStartedAt = 0L      // SystemClock.elapsedRealtime() do último "iniciar"
    private var timerAccumulated = 0L    // tempo já contado antes da última pausa (ms)
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            updateTimerText()
            if (timerRunning) handler.postDelayed(this, 250)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_reader)
        Insets.applySystemBars(findViewById(R.id.root))
        ap = Aparencia.load(this)
        applyWindowPrefs()

        val email = intent.getStringExtra(EXTRA_EMAIL) ?: return finish()
        val id = intent.getStringExtra(EXTRA_ID) ?: return finish()
        val lib = Library(this, email)
        posKey = "${lib.accountKey}_$id"
        marcasFile = lib.marcasFile(id)

        toolbar = findViewById(R.id.toolbar)
        toolbar.title = intent.getStringExtra(EXTRA_TITLE)
        toolbar.setNavigationOnClickListener { finish() }
        toolbar.inflateMenu(R.menu.reader)
        toolbar.setOnMenuItemClickListener(::onMenu)

        setupSearch()
        colorirBarras()
        setupTimer()

        web = findViewById(R.id.web)
        val progress = findViewById<ProgressBar>(R.id.loading)
        web.setBackgroundColor(ap.temaAtivo(this).fundo)
        web.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            builtInZoomControls = false
            textZoom = ap.tamanho
        }
        web.addJavascriptInterface(Bridge(), "Leitor")
        web.setFindListener { active, total, done ->
            if (done) searchCount.text = if (total == 0) "0" else "${active + 1} de $total"
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (searchBar.visibility == View.VISIBLE) { closeSearch(); return }
                web.evaluateJavascript("window.leitor ? window.leitor.closeNote() : false") { r ->
                    if (r != "true") finish()
                }
            }
        })

        lifecycleScope.launch {
            try {
                val dir = withContext(Dispatchers.IO) {
                    val dir = lib.ensureExtracted(id)
                    val book = EpubParser.parse(dir)
                    val marcas = lib.marcasFile(id).takeIf { it.exists() }?.readText()?.takeIf { it.trim().startsWith("[") }
                    val html = ReaderHtmlBuilder.build(dir, book, ap.paraPagina(this@ReaderActivity), marcas)
                    File(dir, "__leitor.html").writeText(html)
                    toc = book.toc.ifEmpty { headingsFallback(html) }
                    dir
                }
                setupWebView(dir)
                web.loadUrl("https://appassets.androidplatform.net/book/__leitor.html")
            } catch (e: Exception) {
                progress.visibility = View.GONE
                AlertDialog.Builder(this@ReaderActivity)
                    .setTitle("Não foi possível abrir")
                    .setMessage("Este arquivo não pôde ser aberto: ${e.message}")
                    .setPositiveButton("OK") { _, _ -> finish() }
                    .setCancelable(false)
                    .show()
            }
        }
    }

    private fun setupWebView(dir: File) {
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/book/", WebViewAssetLoader.InternalStoragePathHandler(this, dir))
            .build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host != WebViewAssetLoader.DEFAULT_DOMAIN) {
                    // o leitor é offline: nada de carregar coisas da internet
                    return WebResourceResponse("text/plain", "utf-8", null)
                }
                return loader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun onPageFinished(view: WebView, url: String) {
                findViewById<View>(R.id.loading).visibility = View.GONE
            }
        }
    }

    /** Sumário alternativo a partir dos títulos, quando o EPUB não tem sumário. */
    private fun headingsFallback(html: String): List<TocEntry> =
        Jsoup.parse(html).select("h1[id], h2[id], h3[id]").map {
            TocEntry(it.text().trim(), it.id(), it.tagName().substring(1).toInt())
        }.filter { it.title.isNotEmpty() }

    private fun js(code: String) = web.evaluateJavascript(code, null)

    private fun onMenu(item: MenuItem): Boolean {
        when (item.itemId) {
            R.id.action_toc -> showToc()
            R.id.action_marcas -> mostrarMarcas()
            R.id.action_search -> openSearch()
            R.id.action_timer -> toggleTimerVisible()
            R.id.action_smaller -> changeZoom(-1)
            R.id.action_bigger -> changeZoom(+1)
            R.id.action_aparencia -> AparenciaSheet(this, ap, apresentacao, onChange = ::applyAparencia, onApresentacao = ::toggleApresentacao).show()
            else -> return false
        }
        return true
    }

    private fun zoomAtual() = if (apresentacao) ap.tamanhoApresentacao else ap.tamanho

    /** Aplica uma aparência nova (vinda do painel Aa) sem perder o ponto de leitura. */
    private fun applyAparencia(novo: Aparencia) {
        val zoomAntes = zoomAtual()
        ap = novo
        applyWindowPrefs()
        web.setBackgroundColor(ap.temaAtivo(this).fundo)
        colorirBarras()
        if (zoomAtual() != zoomAntes) setZoom(zoomAtual())
        js("window.leitor && window.leitor.applyAppearance(${ap.paraPagina(this)})")
    }

    private fun applyWindowPrefs() {
        if (ap.telaLigada || apresentacao) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val lp = window.attributes
        lp.screenBrightness = if (ap.brilho < 0) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else ap.brilho.coerceIn(0.02f, 1f)
        window.attributes = lp
    }

    private fun setZoom(z: Int) {
        js("window.leitor && window.leitor.mark()")
        web.settings.textZoom = z
        web.postDelayed({ js("window.leitor && window.leitor.backToMark()") }, 200)
    }

    private fun changeZoom(step: Int) {
        val cur = zoomAtual()
        val idx = ZOOMS.indexOfFirst { it >= cur }.let { if (it < 0) ZOOMS.size - 1 else it }
        val next = ZOOMS[(idx + step).coerceIn(0, ZOOMS.size - 1)]
        if (next == cur) return
        ap = if (apresentacao) ap.copy(tamanhoApresentacao = next) else ap.copy(tamanho = next)
        Aparencia.save(this, ap)
        setZoom(next)
        Toast.makeText(this, "Tamanho do texto: $next%", Toast.LENGTH_SHORT).show()
    }

    /** Modo apresentação: letra grande, tela cheia, tela sempre ligada e cronômetro à vista. */
    private fun toggleApresentacao() {
        apresentacao = !apresentacao
        applyWindowPrefs()
        setZoom(zoomAtual())
        if (apresentacao) {
            if (timerView.visibility != View.VISIBLE) { timerView.visibility = View.VISIBLE; updateTimerText() }
            if (uiVisible) toggleUi()
            Toast.makeText(this, "Modo apresentação. Toque no texto para mostrar a barra; para sair, use o botão Aa.", Toast.LENGTH_LONG).show()
        } else {
            if (!uiVisible) toggleUi()
            Toast.makeText(this, "Modo apresentação desligado.", Toast.LENGTH_SHORT).show()
        }
    }

    /** Lista das marcações deste discurso: tocar leva até ela; segurar apaga. */
    private fun mostrarMarcas() {
        web.evaluateJavascript("window.leitor ? window.leitor.listarMarcas() : '[]'") { r ->
            val arr = runCatching { org.json.JSONArray(org.json.JSONTokener(r).nextValue() as String) }.getOrNull() ?: org.json.JSONArray()
            if (arr.length() == 0) {
                AlertDialog.Builder(this)
                    .setTitle("Marcações")
                    .setMessage("Nenhuma marcação neste discurso.\n\nPara marcar: toque e segure numa palavra, ajuste a seleção e escolha uma cor na barra que aparece (marca-texto, cor da letra, negrito ou sublinhado).\n\nPara mudar ou apagar uma marcação, toque nela.")
                    .setPositiveButton("OK", null).show()
                return@evaluateJavascript
            }
            val ids = (0 until arr.length()).map { arr.getJSONObject(it).getString("id") }
            val rotulos = (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                val cor = o.optString("fundo").takeIf { it.isNotEmpty() && it != "null" } ?: o.optString("cor").takeIf { it.isNotEmpty() && it != "null" } ?: "estilo"
                val t = o.optString("texto").replace(Regex("\\s+"), " ").let { if (it.length > 90) it.take(87) + "…" else it }
                (if (o.optBoolean("achada", true)) "" else "(não encontrada nesta versão) ") + "● $cor — $t"
            }
            val dlg = AlertDialog.Builder(this)
                .setTitle("Marcações (${ids.size})")
                .setItems(rotulos.toTypedArray()) { _, w -> js("window.leitor.irParaMarca(${JSONObject.quote(ids[w])})") }
                .setNeutralButton("Apagar todas") { _, _ ->
                    AlertDialog.Builder(this)
                        .setTitle("Apagar todas as marcações?")
                        .setMessage("As marcações deste discurso serão removidas. O texto do discurso não muda.")
                        .setPositiveButton("Apagar") { _, _ -> js("window.leitor.apagarTodasMarcas()") }
                        .setNegativeButton("Cancelar", null).show()
                }
                .setNegativeButton("Fechar", null)
                .create()
            dlg.listView.setOnItemLongClickListener { _, _, w, _ ->
                js("window.leitor.apagarMarca(${JSONObject.quote(ids[w])})")
                dlg.dismiss()
                Toast.makeText(this, "Marcação apagada.", Toast.LENGTH_SHORT).show()
                true
            }
            dlg.show()
        }
    }

    private fun showToc() {
        if (toc.isEmpty()) {
            Toast.makeText(this, "Este arquivo não tem sumário.", Toast.LENGTH_SHORT).show()
            return
        }
        val labels = toc.map { " ".repeat((it.level - 1).coerceIn(0, 4)) + it.title }
        AlertDialog.Builder(this)
            .setTitle("Sumário")
            .setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, labels)) { _, which ->
                js("window.leitor && window.leitor.goTo(${JSONObject.quote(toc[which].anchor)})")
            }
            .setNegativeButton("Fechar", null)
            .show()
    }

    // ---------------- busca ----------------

    /** Barra de cima, barra de busca e barras do sistema com as cores do tema do leitor. */
    private fun colorirBarras() {
        val t = ap.temaAtivo(this)
        val fg = t.texto
        // a barra fica um tiquinho diferente do fundo do texto, para se distinguir dele
        val bg = ColorUtils.blendARGB(t.fundo, fg, 0.05f)
        val suave = ColorUtils.setAlphaComponent(fg, 0xB0)
        findViewById<View>(R.id.root).setBackgroundColor(bg)
        toolbar.setBackgroundColor(bg)
        toolbar.setTitleTextColor(fg)
        toolbar.setSubtitleTextColor(suave)
        toolbar.navigationIcon?.mutate()?.setTint(fg)
        toolbar.overflowIcon?.mutate()?.setTint(fg)
        for (i in 0 until toolbar.menu.size()) toolbar.menu.getItem(i).icon?.mutate()?.setTint(fg)
        // os botões de texto (A−, A+, Aa) só existem depois de a barra ser desenhada
        toolbar.post { tingirBotoes(toolbar, fg) }
        searchBar.setBackgroundColor(bg)
        searchText.setTextColor(fg)
        searchText.setHintTextColor(suave)
        searchCount.setTextColor(fg)
        listOf(R.id.searchPrev, R.id.searchNext, R.id.searchClose).forEach { findViewById<ImageView>(it).setColorFilter(fg) }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !t.escuro
            isAppearanceLightNavigationBars = !t.escuro
        }
    }

    private fun tingirBotoes(v: View, cor: Int) {
        if (v is TextView && v.parent is androidx.appcompat.widget.ActionMenuView) v.setTextColor(cor)
        if (v is ViewGroup) for (i in 0 until v.childCount) tingirBotoes(v.getChildAt(i), cor)
    }

    private fun setupSearch() {
        searchBar = findViewById(R.id.searchBar)
        searchText = findViewById(R.id.searchText)
        searchCount = findViewById(R.id.searchCount)
        findViewById<View>(R.id.searchNext).setOnClickListener { web.findNext(true); hideKeyboard() }
        findViewById<View>(R.id.searchPrev).setOnClickListener { web.findNext(false); hideKeyboard() }
        findViewById<View>(R.id.searchClose).setOnClickListener { closeSearch() }
        val runSearch = Runnable {
            val q = searchText.text.toString().trim()
            if (q.isEmpty()) { web.clearMatches(); searchCount.text = "" } else web.findAllAsync(q)
        }
        searchText.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                handler.removeCallbacks(runSearch)
                handler.postDelayed(runSearch, 300)
            }
        })
        searchText.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEARCH) { web.findNext(true); hideKeyboard(); true } else false
        }
    }

    private fun openSearch() {
        if (!uiVisible) toggleUi()
        js("window.leitor && window.leitor.closeNote()")
        searchBar.visibility = View.VISIBLE
        searchText.requestFocus()
        searchText.selectAll()
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(searchText, 0)
    }

    private fun closeSearch() {
        hideKeyboard()
        web.clearMatches()
        searchCount.text = ""
        searchBar.visibility = View.GONE
    }

    private fun hideKeyboard() {
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(searchText.windowToken, 0)
    }

    // ---------------- cronômetro ----------------

    private fun setupTimer() {
        timerView = findViewById(R.id.timer)
        timerView.setOnClickListener { if (timerRunning) pauseTimer() else startTimer() }
        timerView.setOnLongClickListener {
            AlertDialog.Builder(this)
                .setTitle("Cronômetro")
                .setItems(arrayOf("Zerar", "Esconder cronômetro")) { _, which ->
                    if (which == 0) resetTimer() else { pauseTimer(); timerView.visibility = View.GONE }
                }
                .show()
            true
        }
    }

    private fun toggleTimerVisible() {
        if (timerView.visibility == View.VISIBLE) {
            pauseTimer()
            timerView.visibility = View.GONE
        } else {
            timerView.visibility = View.VISIBLE
            updateTimerText()
            Toast.makeText(this, "Toque no relógio para iniciar/pausar. Toque e segure para zerar.", Toast.LENGTH_LONG).show()
        }
    }

    private fun elapsed() = timerAccumulated + if (timerRunning) SystemClock.elapsedRealtime() - timerStartedAt else 0

    private fun startTimer() {
        timerStartedAt = SystemClock.elapsedRealtime()
        timerRunning = true
        timerView.setBackgroundResource(R.drawable.bg_timer_running)
        handler.post(tick)
    }

    private fun pauseTimer() {
        if (!timerRunning) return
        timerAccumulated = elapsed()
        timerRunning = false
        handler.removeCallbacks(tick)
        timerView.setBackgroundResource(R.drawable.bg_timer)
        updateTimerText()
    }

    private fun resetTimer() {
        val wasRunning = timerRunning
        pauseTimer()
        timerAccumulated = 0
        updateTimerText()
        if (wasRunning) startTimer()
    }

    private fun updateTimerText() {
        val s = elapsed() / 1000
        timerView.text = if (s >= 3600) "%d:%02d:%02d".format(s / 3600, (s / 60) % 60, s % 60) else "%02d:%02d".format(s / 60, s % 60)
    }

    // ---------------- tela cheia ----------------

    private fun toggleUi() {
        uiVisible = !uiVisible
        val ctrl = WindowCompat.getInsetsController(window, window.decorView)
        if (uiVisible) {
            toolbar.visibility = View.VISIBLE
            ctrl.show(WindowInsetsCompat.Type.systemBars())
        } else {
            if (searchBar.visibility == View.VISIBLE) closeSearch()
            toolbar.visibility = View.GONE
            ctrl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            ctrl.hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun openExternal(url: String) {
        AlertDialog.Builder(this)
            .setTitle("Abrir link")
            .setMessage("Abrir este endereço no navegador?\n\n$url")
            .setPositiveButton("Abrir") { _, _ ->
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    /** Funções chamadas pelo JavaScript da página de leitura. */
    inner class Bridge {
        @JavascriptInterface
        fun onReady() = runOnUiThread {
            val pos = Prefs.position(this@ReaderActivity, posKey)
            if (pos != null) js("window.leitor.restore(${pos.first}, ${pos.second})")
        }

        @JavascriptInterface
        fun onPosition(index: Int, frac: Double) {
            Prefs.setPosition(this@ReaderActivity, posKey, index, frac)
        }

        @JavascriptInterface
        fun onProgress(percent: Int) = runOnUiThread { toolbar.subtitle = "$percent% lido" }

        @JavascriptInterface
        fun salvarMarcas(json: String) {
            runCatching {
                val tmp = File(marcasFile.parentFile, marcasFile.name + ".tmp")
                tmp.writeText(json)
                tmp.renameTo(marcasFile)
            }
        }

        @JavascriptInterface
        fun toggleUi() = runOnUiThread { this@ReaderActivity.toggleUi() }

        @JavascriptInterface
        fun openExternal(url: String) = runOnUiThread { this@ReaderActivity.openExternal(url) }
    }
}
