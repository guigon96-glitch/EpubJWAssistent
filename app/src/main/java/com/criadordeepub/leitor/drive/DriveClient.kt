package com.criadordeepub.leitor.drive

import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** O token de acesso expirou ou foi revogado (HTTP 401). */
class AuthExpiredException : IOException("Token expirado")

class DriveHttpException(val code: Int, msg: String) : IOException(msg)

/**
 * Chamadas mínimas à API REST do Google Drive v3 (somente leitura de arquivos criados pelo app,
 * escopo drive.file). Não usa nenhuma biblioteca extra: só HttpURLConnection.
 */
class DriveClient(private val accessToken: String) {

    companion object {
        const val FOLDER_NAME = "Criador de EPUB"
        private const val API = "https://www.googleapis.com/drive/v3"
        const val EPUB_MIME = "application/epub+zip"
        const val FOLDER_MIME = "application/vnd.google-apps.folder"
    }

    data class UserInfo(val email: String, val name: String)

    fun userInfo(): UserInfo {
        val json = JSONObject(getText("https://www.googleapis.com/oauth2/v3/userinfo"))
        return UserInfo(json.optString("email"), json.optString("name"))
    }

    /** Ids das pastas "Criador de EPUB" na raiz do Meu Drive (normalmente só uma). */
    fun findFolders(): List<String> {
        val q = "name='$FOLDER_NAME' and mimeType='$FOLDER_MIME' and trashed=false and 'root' in parents"
        return listAll(q, "files(id)").map { it.getString("id") }
    }

    /** Subpastas (categorias) das pastas raiz. */
    fun listSubfolders(rootIds: List<String>): List<Pair<Categorias.Pasta, List<String>>> =
        rootIds.chunked(40).flatMap { chunk ->
            val parents = chunk.joinToString(" or ") { "'$it' in parents" }
            listAll("($parents) and mimeType='$FOLDER_MIME' and trashed=false", "files(id,name,parents)")
                .map { Categorias.Pasta(it.getString("id"), it.optString("name")) to parentsOf(it) }
        }

    /** EPUBs dentro das pastas indicadas (mais recentes primeiro). */
    fun listEpubFiles(folderIds: List<String>): List<Categorias.Arquivo> =
        folderIds.distinct().chunked(40).flatMap { chunk ->
            val parents = chunk.joinToString(" or ") { "'$it' in parents" }
            listAll(
                "($parents) and trashed=false and mimeType != '$FOLDER_MIME'",
                "files(id,name,modifiedTime,size,mimeType,parents)",
                orderBy = "modifiedTime desc",
            ).filter { Categorias.ehEpub(it.optString("name"), it.optString("mimeType")) }
                .map {
                    Categorias.Arquivo(
                        id = it.getString("id"), name = it.optString("name"),
                        modifiedTime = it.optString("modifiedTime"),
                        size = it.optString("size").toLongOrNull() ?: 0L, parents = parentsOf(it),
                    )
                }
        }

    /** Cria uma pasta (usado para criar a pasta raiz ou uma categoria nova). Devolve o id. */
    fun createFolder(name: String, parentId: String): String {
        val body = JSONObject().put("name", name).put("mimeType", FOLDER_MIME)
            .put("parents", org.json.JSONArray().put(parentId)).toString().toByteArray()
        val conn = open("$API/files?fields=id")
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            conn.outputStream.use { it.write(body) }
            check(conn)
            return JSONObject(conn.inputStream.bufferedReader().use { it.readText() }).getString("id")
        } finally {
            conn.disconnect()
        }
    }

    private fun parentsOf(o: JSONObject): List<String> {
        val arr = o.optJSONArray("parents") ?: return emptyList()
        return (0 until arr.length()).map { arr.getString(it) }
    }

    /** Baixa o conteúdo do arquivo para [dest] (grava num temporário e só então substitui). */
    fun download(fileId: String, dest: File) {
        val conn = open("$API/files/${enc(fileId)}?alt=media&supportsAllDrives=true")
        try {
            check(conn)
            val tmp = File(dest.parentFile, dest.name + ".part")
            conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
            if (dest.exists()) dest.delete()
            if (!tmp.renameTo(dest)) throw IOException("Não foi possível salvar o arquivo")
        } finally {
            conn.disconnect()
        }
    }

    private fun listAll(q: String, fields: String, orderBy: String? = null): List<JSONObject> {
        val out = ArrayList<JSONObject>()
        var pageToken: String? = null
        do {
            val url = StringBuilder("$API/files?pageSize=200&spaces=drive")
                .append("&q=").append(enc(q))
                .append("&fields=").append(enc("nextPageToken,$fields"))
            if (orderBy != null) url.append("&orderBy=").append(enc(orderBy))
            if (pageToken != null) url.append("&pageToken=").append(enc(pageToken))
            val json = JSONObject(getText(url.toString()))
            val arr = json.optJSONArray("files")
            if (arr != null) for (i in 0 until arr.length()) out += arr.getJSONObject(i)
            pageToken = json.optString("nextPageToken").ifEmpty { null }
        } while (pageToken != null)
        return out
    }

    private fun getText(url: String): String {
        val conn = open(url)
        try {
            check(conn)
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 60_000
            setRequestProperty("Authorization", "Bearer $accessToken")
        }

    private fun check(conn: HttpURLConnection) {
        val code = conn.responseCode
        if (code == 401) throw AuthExpiredException()
        if (code !in 200..299) {
            val body = runCatching { conn.errorStream?.bufferedReader()?.use { it.readText() } }.getOrNull().orEmpty()
            throw DriveHttpException(code, "Erro $code do Google Drive. ${body.take(300)}")
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
}
