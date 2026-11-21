package com.criadordeepub.leitor

import android.content.Context
import com.criadordeepub.leitor.epub.EpubExtractor
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Um EPUB da biblioteca local.
 * [source] = "drive" (veio da pasta do Drive) ou "local" (aberto a partir de um arquivo do tablet).
 * [downloadedModified] = modifiedTime do Drive da versão que está baixada (null = ainda não baixado).
 */
data class BookEntry(
    val id: String,
    val name: String,
    val modifiedTime: String,
    val downloadedModified: String?,
    val source: String,
    val category: String = "Outros",
) {
    val isDownloaded get() = downloadedModified != null
    val needsUpdate get() = source == "drive" && downloadedModified != modifiedTime
    val displayName get() = com.criadordeepub.leitor.drive.Categorias.titulo(name)
}

/** Arquivos de uma conta: cada pessoa (conta Google) tem a sua própria pasta dentro do app. */
class Library(context: Context, val accountEmail: String) {

    val accountKey: String = sha1(accountEmail.lowercase()).take(16)
    private val root = File(context.filesDir, "contas/$accountKey").apply { mkdirs() }
    private val indexFile = File(root, "biblioteca.json")
    private val categoriesFile = File(root, "categorias.json")

    /** Categorias conhecidas (na ordem de exibição), guardadas para funcionar sem internet. */
    @Synchronized
    fun loadCategories(): List<String> = runCatching {
        val arr = JSONArray(categoriesFile.readText())
        (0 until arr.length()).map { arr.getString(it) }
    }.getOrDefault(com.criadordeepub.leitor.drive.Categorias.PADRAO)

    @Synchronized
    fun saveCategories(list: List<String>) {
        categoriesFile.writeText(JSONArray(list).toString())
    }

    fun epubFile(id: String) = File(root, "epub/${safe(id)}.epub").apply { parentFile?.mkdirs() }
    fun bookDir(id: String) = File(root, "livros/${safe(id)}")

    /** Marcações (marca-texto, cores) do leitor, guardadas por discurso. Não alteram o EPUB. */
    fun marcasFile(id: String) = File(root, "marcas/${safe(id)}.json").apply { parentFile?.mkdirs() }

    @Synchronized
    fun load(): List<BookEntry> {
        if (!indexFile.exists()) return emptyList()
        return runCatching {
            val arr = JSONArray(indexFile.readText())
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                BookEntry(
                    id = o.getString("id"),
                    name = o.optString("name"),
                    modifiedTime = o.optString("modifiedTime"),
                    downloadedModified = if (o.isNull("downloadedModified")) null else o.optString("downloadedModified"),
                    source = o.optString("source", "drive"),
                    category = o.optString("category", "Outros"),
                )
            }.filter { it.source == "local" || epubFile(it.id).exists() || !it.isDownloaded }
        }.getOrDefault(emptyList())
    }

    @Synchronized
    fun save(list: List<BookEntry>) {
        val arr = JSONArray()
        list.forEach {
            arr.put(JSONObject().apply {
                put("id", it.id); put("name", it.name); put("modifiedTime", it.modifiedTime)
                put("downloadedModified", it.downloadedModified ?: JSONObject.NULL); put("source", it.source)
                put("category", it.category)
            })
        }
        val tmp = File(root, "biblioteca.json.tmp")
        tmp.writeText(arr.toString())
        tmp.renameTo(indexFile)
    }

    fun delete(id: String) {
        epubFile(id).delete()
        bookDir(id).deleteRecursively()
    }

    fun deleteEverything() = root.deleteRecursively()

    /** Garante que o EPUB esteja extraído e atualizado; devolve a pasta extraída. */
    fun ensureExtracted(id: String): File {
        val epub = epubFile(id)
        val dir = bookDir(id)
        val marker = File(dir, ".versao")
        val stamp = "${epub.length()}-${epub.lastModified()}"
        if (!marker.exists() || marker.readText() != stamp) {
            epub.inputStream().use { EpubExtractor.extract(it, dir) }
            marker.writeText(stamp)
        }
        return dir
    }

    companion object {
        fun sha1(s: String): String =
            MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

        private fun safe(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "_")
    }
}
