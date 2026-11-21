package com.criadordeepub.leitor.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SearchView
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.criadordeepub.leitor.BookEntry
import com.criadordeepub.leitor.GoogleAuth
import com.criadordeepub.leitor.Library
import com.criadordeepub.leitor.NeedsUserException
import com.criadordeepub.leitor.Prefs
import com.criadordeepub.leitor.R
import com.criadordeepub.leitor.atualizacao.Atualizador
import com.criadordeepub.leitor.atualizacao.Versoes
import com.google.android.material.progressindicator.LinearProgressIndicator
import android.widget.LinearLayout
import java.io.File
import com.criadordeepub.leitor.drive.AuthExpiredException
import com.criadordeepub.leitor.drive.Categorias
import com.criadordeepub.leitor.drive.DriveClient
import com.criadordeepub.leitor.drive.DriveHttpException
import com.criadordeepub.leitor.epub.EpubParser
import com.google.android.gms.common.api.ApiException
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.tabs.TabLayout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.UnknownHostException
import java.util.UUID

class MainActivity : AppCompatActivity() {

    companion object {
        /** Aba dos arquivos abertos a partir do próprio tablet. */
        const val ABA_TABLET = "No tablet"
    }

    private lateinit var auth: GoogleAuth
    private lateinit var toolbar: MaterialToolbar
    private lateinit var signInPanel: View
    private lateinit var listPanel: View
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var emptyText: TextView
    private lateinit var tabs: TabLayout
    private lateinit var adapter: BookAdapter

    private var library: Library? = null
    private var lastToken: String? = null
    private var syncJob: Job? = null
    private var abaAtual: String = Categorias.DISCURSOS
    private var busca: String = ""
    private var montandoAbas = false

    private val authLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        auth.onLauncherResult(it.data)
    }

    // ---- atualização do app ----
    private val atualizador by lazy { Atualizador(this) }
    private var apkPendente: File? = null
    private val permissaoInstalarLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val apk = apkPendente
        if (apk != null && atualizador.podeInstalar()) instalar(apk)
    }

    private val openDocLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) importLocal(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        Insets.applySystemBars(findViewById(R.id.root))

        auth = GoogleAuth(this, authLauncher)
        toolbar = findViewById(R.id.toolbar)
        setSupportActionBar(toolbar)
        signInPanel = findViewById(R.id.signInPanel)
        listPanel = findViewById(R.id.listPanel)
        swipe = findViewById(R.id.swipe)
        emptyText = findViewById(R.id.emptyText)
        tabs = findViewById(R.id.tabs)
        abaAtual = savedInstanceState?.getString("aba") ?: getPreferences(MODE_PRIVATE).getString("aba", abaAtual)!!

        adapter = BookAdapter(onClick = ::openBook, onLongClick = ::confirmRemove)
        findViewById<RecyclerView>(R.id.list).apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = this@MainActivity.adapter
        }
        tabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                if (montandoAbas) return
                abaAtual = tab.tag as String
                getPreferences(MODE_PRIVATE).edit().putString("aba", abaAtual).apply()
                refreshList(rebuildTabs = false)
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })
        swipe.setOnRefreshListener { sync(interactive = true) }
        findViewById<Button>(R.id.signInButton).setOnClickListener { signIn() }

        val email = Prefs.email(this)
        if (email == null) showSignIn() else {
            showLibrary(email)
            sync(interactive = false)
        }
        verificarAtualizacaoDiaria()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("aba", abaAtual)
    }

    // ---------------- telas ----------------

    private fun showSignIn() {
        library = null
        signInPanel.visibility = View.VISIBLE
        listPanel.visibility = View.GONE
        toolbar.subtitle = null
        invalidateOptionsMenu()
    }

    private fun showLibrary(email: String) {
        library = Library(this, email)
        signInPanel.visibility = View.GONE
        listPanel.visibility = View.VISIBLE
        toolbar.subtitle = email
        refreshList()
        invalidateOptionsMenu()
    }

    /**
     * Monta as abas (categorias) e a lista da aba escolhida — ou o resultado da busca.
     * [rebuildTabs] = false quando só a aba ou a busca mudou (as abas continuam as mesmas).
     */
    private fun refreshList(rebuildTabs: Boolean = true) {
        val lib = library ?: return
        val all = lib.load()
        val categorias = Categorias.ordenar(lib.loadCategories() + all.filter { it.source == "drive" }.map { it.category })
        val abas = categorias + if (all.any { it.source == "local" }) listOf(ABA_TABLET) else emptyList()
        if (abaAtual !in abas) abaAtual = abas.first()

        fun daAba(aba: String) = all.filter { if (aba == ABA_TABLET) it.source == "local" else it.source == "drive" && it.category == aba }

        if (rebuildTabs || tabs.tabCount != abas.size) {
            montandoAbas = true
            tabs.removeAllTabs()
            for (aba in abas) {
                val n = daAba(aba).size
                val tab = tabs.newTab().setText(if (n > 0) "$aba ($n)" else aba).setTag(aba)
                tabs.addTab(tab, aba == abaAtual)
            }
            montandoAbas = false
            val sel = abas.indexOf(abaAtual)
            if (sel >= 0) tabs.post { tabs.setScrollPosition(sel, 0f, true) }
        }

        val buscando = busca.isNotBlank()
        tabs.alpha = if (buscando) 0.4f else 1f
        val items = if (buscando) {
            all.filter { Categorias.combina(it.displayName, busca) }
                .sortedWith(compareBy<BookEntry>({ abas.indexOf(if (it.source == "local") ABA_TABLET else it.category) }).thenByDescending { it.modifiedTime })
        } else {
            daAba(abaAtual).sortedByDescending { it.modifiedTime }
        }
        adapter.submit(items, mostrarCategoria = buscando)
        emptyText.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        emptyText.text = when {
            all.isEmpty() -> getString(R.string.empty_text)
            buscando -> "Nenhum discurso encontrado para “$busca”."
            abaAtual == ABA_TABLET -> "Nenhum arquivo aberto do tablet."
            else -> "Nenhum EPUB em “$abaAtual”.\n\nNo programa do computador, salve um discurso nesta categoria e puxe a tela para baixo."
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main, menu)
        val item = menu.findItem(R.id.action_search)
        (item.actionView as SearchView).apply {
            queryHint = "Buscar por título"
            maxWidth = Int.MAX_VALUE
            setOnQueryTextListener(object : SearchView.OnQueryTextListener {
                override fun onQueryTextSubmit(q: String?) = true.also { clearFocus() }
                override fun onQueryTextChange(q: String?): Boolean {
                    busca = q.orEmpty()
                    refreshList(rebuildTabs = false)
                    return true
                }
            })
        }
        item.setOnActionExpandListener(object : MenuItem.OnActionExpandListener {
            override fun onMenuItemActionExpand(item: MenuItem) = true
            override fun onMenuItemActionCollapse(item: MenuItem): Boolean {
                busca = ""
                refreshList(rebuildTabs = false)
                return true
            }
        })
        return true
    }

    override fun onPrepareOptionsMenu(menu: Menu): Boolean {
        val logged = library != null
        listOf(R.id.action_search, R.id.action_refresh, R.id.action_new_category, R.id.action_open_file, R.id.action_sign_out)
            .forEach { menu.findItem(it).isVisible = logged }
        return super.onPrepareOptionsMenu(menu)
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) {
            R.id.action_refresh -> { swipe.isRefreshing = true; sync(interactive = true) }
            R.id.action_new_category -> askNewCategory()
            R.id.action_open_file -> openDocLauncher.launch(arrayOf("application/epub+zip", "application/octet-stream", "*/*"))
            R.id.action_sign_out -> confirmSignOut()
            R.id.action_update -> verificarAtualizacao(manual = true)
            R.id.action_about -> AlertDialog.Builder(this)
                .setTitle(R.string.app_name)
                .setMessage(getString(R.string.about_text) + "\n\nVersão instalada: " + atualizador.versaoAtual())
                .setPositiveButton("OK", null).show()
            R.id.action_search -> return false
            else -> return super.onOptionsItemSelected(item)
        }
        return true
    }

    // ---------------- conta ----------------

    private fun signIn() {
        lifecycleScope.launch {
            try {
                val token = auth.accessToken(email = null, interactive = true)
                lastToken = token
                val info = withContext(Dispatchers.IO) { DriveClient(token).userInfo() }
                if (info.email.isBlank()) throw IOException("Não foi possível ler o e-mail da conta.")
                Prefs.setAccount(this@MainActivity, info.email, info.name)
                showLibrary(info.email)
                swipe.isRefreshing = true
                runSync(token)
            } catch (e: Exception) {
                showError(e)
            } finally {
                swipe.isRefreshing = false
            }
        }
    }

    private fun confirmSignOut() {
        val email = Prefs.email(this) ?: return
        AlertDialog.Builder(this)
            .setTitle("Sair da conta")
            .setMessage("Sair de $email?\n\nVocê pode manter os discursos baixados neste tablet (para quando entrar de novo) ou apagá-los.")
            .setPositiveButton("Sair") { _, _ -> signOut(deleteFiles = false) }
            .setNeutralButton("Sair e apagar") { _, _ -> signOut(deleteFiles = true) }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun signOut(deleteFiles: Boolean) {
        syncJob?.cancel()
        val lib = library
        lifecycleScope.launch {
            auth.signOut(lastToken)
            lastToken = null
            if (deleteFiles && lib != null) {
                withContext(Dispatchers.IO) { lib.deleteEverything() }
                Prefs.clearPositions(this@MainActivity, lib.accountKey)
            }
            Prefs.setAccount(this@MainActivity, null, null)
            showSignIn()
        }
    }

    // ---------------- sincronização com o Drive ----------------

    private fun sync(interactive: Boolean) {
        val email = Prefs.email(this) ?: return
        syncJob?.cancel()
        syncJob = lifecycleScope.launch {
            swipe.isRefreshing = true
            try {
                val token = auth.accessToken(email, interactive)
                lastToken = token
                runSync(token)
            } catch (e: NeedsUserException) {
                Snackbar.make(swipe, "Puxe a lista para baixo para conectar ao Google Drive.", Snackbar.LENGTH_LONG).show()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                showError(e)
            } finally {
                swipe.isRefreshing = false
            }
        }
    }

    /** Executa chamadas ao Drive renovando o token uma vez se ele tiver expirado. */
    private suspend fun <T> drive(block: (DriveClient) -> T): T {
        val lib = library ?: throw IOException("Sem conta")
        val token = lastToken ?: auth.accessToken(lib.accountEmail, interactive = true).also { lastToken = it }
        return try {
            withContext(Dispatchers.IO) { block(DriveClient(token)) }
        } catch (e: AuthExpiredException) {
            auth.clearToken(token)
            val novo = auth.accessToken(lib.accountEmail, interactive = true)
            lastToken = novo
            withContext(Dispatchers.IO) { block(DriveClient(novo)) }
        }
    }

    private suspend fun runSync(firstToken: String) {
        val lib = library ?: return
        lastToken = firstToken

        // pasta raiz → subpastas (categorias) → EPUBs (soltos na raiz = "Outros")
        val roots = drive { it.findFolders() }
        val subpastas = if (roots.isEmpty()) emptyList() else drive { it.listSubfolders(roots) }.map { it.first }
        val arquivos = if (roots.isEmpty()) emptyList() else drive { it.listEpubFiles(roots + subpastas.map { p -> p.id }) }
        val remote = Categorias.agrupar(roots.toSet(), subpastas, arquivos)

        lib.saveCategories(Categorias.ordenar(subpastas.map { it.nome }))
        val current = lib.load()
        val byId = current.associateBy { it.id }

        // lista nova: arquivos do Drive (nome e categoria atualizados pelo id) + arquivos abertos do tablet
        var merged = remote.map { r ->
            val f = r.arquivo
            BookEntry(f.id, f.name, f.modifiedTime, byId[f.id]?.downloadedModified, "drive", r.categoria)
        } + current.filter { it.source == "local" }
        // arquivos que saíram do Drive (apagados ou na lixeira) são apagados do tablet
        val remoteIds = remote.map { it.arquivo.id }.toSet()
        current.filter { it.source == "drive" && it.id !in remoteIds }.forEach { lib.delete(it.id) }
        lib.save(merged)
        refreshList()

        // baixa o que é novo ou foi alterado (modifiedTime diferente)
        var failures = 0
        for (entry in merged.filter { it.needsUpdate }) {
            adapter.setBusy(entry.id, true)
            try {
                drive { it.download(entry.id, lib.epubFile(entry.id)) }
                withContext(Dispatchers.IO) { lib.bookDir(entry.id).deleteRecursively() }
                merged = merged.map { if (it.id == entry.id) it.copy(downloadedModified = it.modifiedTime) else it }
                lib.save(merged)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                failures++
            } finally {
                adapter.setBusy(entry.id, false)
                refreshList()
            }
        }
        val msg = when {
            failures > 0 -> "$failures arquivo(s) não puderam ser baixados. Tente atualizar de novo."
            roots.isEmpty() -> "Ainda não existe a pasta \"${DriveClient.FOLDER_NAME}\" no seu Drive. Salve um discurso pelo programa do computador."
            remote.isEmpty() -> "Nenhum EPUB ainda — crie no app do PC."
            else -> "Lista atualizada."
        }
        Snackbar.make(swipe, msg, if (roots.isEmpty()) Snackbar.LENGTH_LONG else Snackbar.LENGTH_SHORT).show()
    }

    // ---------------- nova categoria ----------------

    private fun askNewCategory() {
        val pad = (20 * resources.displayMetrics.density).toInt()
        val input = EditText(this).apply { hint = "Nome da categoria"; isSingleLine = true }
        val box = FrameLayout(this).apply { setPadding(pad, pad / 2, pad, 0); addView(input) }
        AlertDialog.Builder(this)
            .setTitle("Nova categoria")
            .setMessage("A categoria é criada como uma subpasta de \"${DriveClient.FOLDER_NAME}\" no seu Drive e também aparece no programa do computador.")
            .setView(box)
            .setPositiveButton("Criar") { _, _ ->
                val nome = input.text.toString().trim()
                if (nome.isNotEmpty()) createCategory(nome)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun createCategory(nome: String) {
        val lib = library ?: return
        if (Categorias.ordenar(lib.loadCategories()).any { Categorias.combina(it, nome) && Categorias.combina(nome, it) }) {
            Snackbar.make(swipe, "A categoria “$nome” já existe.", Snackbar.LENGTH_SHORT).show()
            return
        }
        lifecycleScope.launch {
            swipe.isRefreshing = true
            try {
                drive { c ->
                    val root = c.findFolders().firstOrNull() ?: c.createFolder(DriveClient.FOLDER_NAME, "root")
                    c.createFolder(nome, root)
                }
                abaAtual = nome
                runSync(lastToken!!)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                showError(e)
            } finally {
                swipe.isRefreshing = false
            }
        }
    }

    // ---------------- abrir / importar ----------------

    private fun openBook(entry: BookEntry) {
        val lib = library ?: return
        if (!entry.isDownloaded || !lib.epubFile(entry.id).exists()) {
            Snackbar.make(swipe, "Este discurso ainda não foi baixado. Conecte à internet e puxe a lista para baixo.", Snackbar.LENGTH_LONG).show()
            return
        }
        startActivity(
            Intent(this, ReaderActivity::class.java)
                .putExtra(ReaderActivity.EXTRA_EMAIL, lib.accountEmail)
                .putExtra(ReaderActivity.EXTRA_ID, entry.id)
                .putExtra(ReaderActivity.EXTRA_TITLE, entry.displayName)
        )
    }

    private fun importLocal(uri: Uri) {
        val lib = library ?: return
        lifecycleScope.launch {
            try {
                val name = queryName(uri) ?: "Arquivo.epub"
                val id = "local-" + UUID.randomUUID().toString()
                withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.use { input ->
                        lib.epubFile(id).outputStream().use { input.copyTo(it) }
                    } ?: throw IOException("Não foi possível ler o arquivo.")
                    try {
                        EpubParser.parse(lib.ensureExtracted(id))
                    } catch (e: Exception) {
                        lib.delete(id)
                        throw IOException("Este arquivo não é um EPUB válido.")
                    }
                }
                val now = java.time.Instant.now().toString()
                lib.save(lib.load() + BookEntry(id, name, now, now, "local", ABA_TABLET))
                abaAtual = ABA_TABLET
                refreshList()
                Snackbar.make(swipe, "\"$name\" foi adicionado ao tablet.", Snackbar.LENGTH_SHORT).show()
            } catch (e: Exception) {
                showError(e)
            }
        }
    }

    private fun queryName(uri: Uri): String? =
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    private fun confirmRemove(entry: BookEntry) {
        if (entry.source != "local") {
            Snackbar.make(swipe, "Este discurso vem do Google Drive. Para tirá-lo da lista, apague-o no programa do computador ou no Drive.", Snackbar.LENGTH_LONG).show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Remover do tablet")
            .setMessage("Remover \"${entry.displayName}\" deste tablet?")
            .setPositiveButton("Remover") { _, _ ->
                val lib = library ?: return@setPositiveButton
                lib.delete(entry.id)
                lib.save(lib.load().filter { it.id != entry.id })
                refreshList()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // ---------------- atualizar o app ----------------

    /** Uma vez por dia, verifica em silêncio e só avisa se houver versão nova. */
    private fun verificarAtualizacaoDiaria() {
        val prefs = getPreferences(MODE_PRIVATE)
        val agora = System.currentTimeMillis()
        if (agora - prefs.getLong("ultimaVerificacao", 0) < 24 * 60 * 60 * 1000L) return
        prefs.edit().putLong("ultimaVerificacao", agora).apply()
        verificarAtualizacao(manual = false)
    }

    private fun verificarAtualizacao(manual: Boolean) {
        lifecycleScope.launch {
            val espera = if (manual) AlertDialog.Builder(this@MainActivity)
                .setTitle("Atualizar app").setMessage("Procurando uma versão nova…").setCancelable(false).show() else null
            try {
                val a = withContext(Dispatchers.IO) { atualizador.buscar() }
                espera?.dismiss()
                when {
                    a != null && manual -> perguntarBaixar(a)
                    a != null -> Snackbar.make(swipe, "Nova versão do app disponível (${a.versao}).", Snackbar.LENGTH_INDEFINITE)
                        .setAction("Atualizar") { perguntarBaixar(a) }.show()
                    manual -> showMessage("App em dia", "Você já tem a versão mais recente (${atualizador.versaoAtual()}).")
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                espera?.dismiss()
                if (manual) showMessage("Não foi possível verificar", mensagemRede(e))
            }
        }
    }

    private fun perguntarBaixar(a: Versoes.Atualizacao) {
        val notas = Versoes.notasSimples(a.notas)
        AlertDialog.Builder(this)
            .setTitle("Nova versão ${a.versao}")
            .setMessage("Você tem a versão ${atualizador.versaoAtual()}." + if (notas.isNotBlank()) "\n\n$notas" else "")
            .setPositiveButton("Baixar") { _, _ -> baixarAtualizacao(a) }
            .setNegativeButton("Agora não", null)
            .show()
    }

    private fun baixarAtualizacao(a: Versoes.Atualizacao) {
        val pad = (24 * resources.displayMetrics.density).toInt()
        val barra = LinearProgressIndicator(this).apply { isIndeterminate = true }
        val texto = TextView(this).apply { text = "Iniciando…"; setPadding(0, pad / 2, 0, 0) }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad / 2, pad, 0)
            addView(barra); addView(texto)
        }
        var job: Job? = null
        val dialog = AlertDialog.Builder(this)
            .setTitle("Baixando a versão ${a.versao}")
            .setView(box)
            .setCancelable(false)
            .setNegativeButton("Cancelar") { _, _ -> job?.cancel() }
            .show()
        job = lifecycleScope.launch {
            try {
                val apk = withContext(Dispatchers.IO) {
                    atualizador.baixar(a) { feito, total ->
                        runOnUiThread {
                            if (total > 0) {
                                barra.isIndeterminate = false
                                barra.setProgressCompat((feito * 100 / total).toInt(), true)
                                texto.text = "%.1f de %.1f MB".format(feito / 1048576.0, total / 1048576.0)
                            } else {
                                texto.text = "%.1f MB".format(feito / 1048576.0)
                            }
                        }
                    }
                }
                dialog.dismiss()
                apkPendente = apk
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Download concluído")
                    .setMessage("A versão ${a.versao} foi baixada e conferida.\n\nToque em \"Instalar\" e confirme na tela do Android. Os discursos baixados e as posições de leitura são mantidos.")
                    .setPositiveButton("Instalar") { _, _ -> instalar(apk) }
                    .setNegativeButton("Depois", null)
                    .show()
            } catch (e: kotlinx.coroutines.CancellationException) {
                dialog.dismiss()
            } catch (e: Exception) {
                dialog.dismiss()
                showMessage("Não foi possível baixar", mensagemRede(e))
            }
        }
    }

    private fun instalar(apk: File) {
        apkPendente = apk
        if (!atualizador.podeInstalar()) {
            AlertDialog.Builder(this)
                .setTitle("Permitir instalação")
                .setMessage("Para instalar a atualização, o Android precisa que você permita que o Leitor de Discursos instale apps.\n\nNa próxima tela, ative \"Permitir desta fonte\" e depois volte (botão Voltar).")
                .setPositiveButton("Abrir configuração") { _, _ -> permissaoInstalarLauncher.launch(atualizador.intentPermissao()) }
                .setNegativeButton("Cancelar", null)
                .show()
            return
        }
        try {
            startActivity(atualizador.intentInstalar(apk))
        } catch (e: Exception) {
            showMessage("Não foi possível abrir o instalador", e.message ?: e.toString())
        }
    }

    private fun mensagemRede(e: Exception) = when (e) {
        is UnknownHostException, is java.net.SocketTimeoutException, is java.net.ConnectException ->
            "Sem conexão com a internet. Tente de novo quando estiver conectado."
        else -> e.message ?: e.toString()
    }

    // ---------------- mensagens ----------------

    private fun showError(e: Exception) {
        val msg = when (e) {
            is UnknownHostException, is java.net.SocketTimeoutException, is java.net.ConnectException ->
                "Sem conexão com a internet. Os discursos já baixados continuam disponíveis."
            is ApiException -> when {
                e.statusCode == 10 || e.message?.contains("UNREGISTERED_ON_API_CONSOLE") == true ->
                    "O Google não reconheceu este app. Confira se o cliente OAuth do tipo Android foi criado no mesmo projeto do Google Cloud, com o nome do pacote e a impressão digital SHA-1 corretos (veja o guia)."
                e.statusCode == 7 -> "Sem conexão com a internet."
                e.statusCode == 16 || e.statusCode == 12501 -> "Login cancelado."
                else -> "Erro do Google (${e.statusCode}): ${e.message}"
            }
            is DriveHttpException -> when (e.code) {
                403 -> "O Google Drive recusou o acesso (403). Confira se a Google Drive API está ativada no projeto do Google Cloud e se a sua conta está na lista de usuários de teste."
                else -> e.message ?: "Erro do Google Drive."
            }
            is SecurityException -> e.message ?: "Permissão negada."
            else -> e.message ?: e.toString()
        }
        showMessage("Algo deu errado", msg)
    }

    private fun showMessage(title: String, msg: String) {
        if (isFinishing) return
        AlertDialog.Builder(this).setTitle(title).setMessage(msg).setPositiveButton("OK", null).show()
    }
}
