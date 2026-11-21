package com.criadordeepub.leitor.atualizacao

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONArray
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Atualização do app pelo GitHub (versões "android-vX.Y" do repositório do Criador de EPUB).
 * Fluxo: [buscar] → [baixar] (confere o SHA-256) → [instalar] (abre o instalador do Android).
 */
class Atualizador(private val context: Context) {

    companion object {
        /** Repositório público onde as versões do app são publicadas. */
        const val REPOSITORIO = "guigon96-glitch/EpubJWAssistent"
        private const val API = "https://api.github.com/repos/$REPOSITORIO/releases?per_page=30"
    }

    fun versaoAtual(): String =
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"

    /** Consulta o GitHub. Devolve a atualização disponível, ou null se o app já está na mais nova. */
    fun buscar(): Versoes.Atualizacao? {
        val arr = JSONArray(texto(API, aceitar = "application/vnd.github+json"))
        val lista = (0 until arr.length()).map { i ->
            val r = arr.getJSONObject(i)
            val assets = r.optJSONArray("assets") ?: JSONArray()
            Versoes.Publicacao(
                tag = r.optString("tag_name"),
                rascunho = r.optBoolean("draft"),
                preLancamento = r.optBoolean("prerelease"),
                notas = r.optString("body"),
                arquivos = (0 until assets.length()).map { j ->
                    val a = assets.getJSONObject(j)
                    Versoes.Arquivo(a.optString("name"), a.optString("browser_download_url"), a.optLong("size"))
                },
            )
        }
        return Versoes.escolher(lista, versaoAtual())
    }

    private fun pasta() = File(context.cacheDir, "atualizacoes").apply { mkdirs() }

    /** Baixa o APK (mostrando o progresso) e confere o SHA-256 quando ele foi publicado. */
    fun baixar(a: Versoes.Atualizacao, progresso: (baixado: Long, total: Long) -> Unit): File {
        pasta().listFiles()?.forEach { it.delete() } // apaga downloads antigos
        val destino = File(pasta(), "Leitor-de-Discursos-${a.versao}.apk")
        val tmp = File(pasta(), destino.name + ".part")
        val md = MessageDigest.getInstance("SHA-256")
        val conn = abrir(a.apk.url)
        try {
            verificar(conn)
            val total = conn.contentLengthLong.takeIf { it > 0 } ?: a.apk.tamanho
            var baixado = 0L
            conn.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var ultimo = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        md.update(buf, 0, n)
                        baixado += n
                        if (baixado - ultimo > 128 * 1024) { progresso(baixado, total); ultimo = baixado }
                    }
                }
            }
            progresso(baixado, total)
        } finally {
            conn.disconnect()
        }
        a.sha256?.let { sha ->
            val esperado = Versoes.lerSha256(texto(sha.url))
            val obtido = md.digest().joinToString("") { "%02x".format(it) }
            if (esperado != null && esperado != obtido) {
                tmp.delete()
                throw IOException("O arquivo baixado está corrompido (SHA-256 não confere). Tente de novo.")
            }
        }
        if (!tmp.renameTo(destino)) throw IOException("Não foi possível salvar a atualização.")
        return destino
    }

    /** No Android 8+, o app precisa da permissão "Instalar apps desconhecidos". */
    fun podeInstalar(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    fun intentPermissao(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))

    /** Abre o instalador do Android com o APK baixado. */
    fun intentInstalar(apk: File): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.arquivos", apk)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    // ---------------- HTTP ----------------

    private fun abrir(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 60_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "LeitorDeDiscursos-Android")
        }

    private fun texto(url: String, aceitar: String? = null): String {
        val conn = abrir(url)
        if (aceitar != null) conn.setRequestProperty("Accept", aceitar)
        try {
            verificar(conn)
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun verificar(conn: HttpURLConnection) {
        val code = conn.responseCode
        if (code == 403 || code == 429) throw IOException("O GitHub pediu para esperar um pouco antes de verificar de novo. Tente daqui a alguns minutos.")
        if (code !in 200..299) throw IOException("Não foi possível verificar atualizações (erro $code).")
    }
}
