package com.criadordeepub.leitor.epub

import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import org.jsoup.nodes.Entities
import org.jsoup.parser.Parser
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.net.URLDecoder
import java.util.zip.ZipInputStream

/** Um item do sumário. [anchor] é o id no documento de leitura montado. */
data class TocEntry(val title: String, val anchor: String, val level: Int)

data class EpubBook(
    val title: String,
    /** Caminhos (relativos à raiz do EPUB extraído) dos arquivos de texto, na ordem de leitura. */
    val spine: List<String>,
    val toc: List<TocEntry>,
    val stylesheets: List<String>,
    /** Arquivos da ordem de leitura que são só a capa (não são mostrados no leitor). */
    val hidden: Set<String> = emptySet(),
)

class EpubException(msg: String) : IOException(msg)

object EpubExtractor {
    /** Extrai o EPUB (zip) para [dest], protegendo contra caminhos maliciosos ("../"). */
    fun extract(input: InputStream, dest: File) {
        if (dest.exists()) dest.deleteRecursively()
        dest.mkdirs()
        val root = dest.canonicalFile
        ZipInputStream(input.buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val out = File(root, entry.name).canonicalFile
                if (!out.path.startsWith(root.path + File.separator)) continue
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { zip.copyTo(it) }
                }
            }
        }
    }
}

object EpubParser {

    fun parse(root: File): EpubBook {
        val container = File(root, "META-INF/container.xml")
        val opfPath = if (container.exists()) {
            val doc = Jsoup.parse(container.readText(), "", Parser.xmlParser())
            doc.selectFirst("rootfile")?.attr("full-path")
        } else null
        val opfRel = opfPath?.takeIf { File(root, it).exists() }
            ?: root.walkTopDown().firstOrNull { it.extension.equals("opf", true) }?.relativeTo(root)?.invariantSeparatorsPath
            ?: throw EpubException("Arquivo EPUB inválido (content.opf não encontrado).")

        val opf = Jsoup.parse(File(root, opfRel).readText(), "", Parser.xmlParser())
        val opfDir = parentOf(opfRel)

        val title = opf.select("metadata > *").firstOrNull { localName(it) == "title" }?.text()?.trim().orEmpty()

        data class Item(val id: String, val path: String, val mediaType: String, val props: String)
        val items = opf.select("manifest > *").filter { localName(it) == "item" }.map {
            Item(it.attr("id"), resolve(opfDir, it.attr("href")), it.attr("media-type"), it.attr("properties"))
        }
        val byId = items.associateBy { it.id }

        val spineEl = opf.select("*").firstOrNull { localName(it) == "spine" }
        val spine = spineEl?.children()?.filter { localName(it) == "itemref" }
            ?.mapNotNull { byId[it.attr("idref")]?.path }
            ?.filter { File(root, it).exists() }
            ?.distinct()
            .orEmpty()
        if (spine.isEmpty()) throw EpubException("O EPUB não tem conteúdo de texto.")

        val hidden = detectCover(root, spineEl, byId.mapValues { it.value.path }, spine)

        val styles = items.filter { it.mediaType == "text/css" && File(root, it.path).exists() }.map { it.path }

        // Sumário: EPUB 3 (nav.xhtml) primeiro, senão EPUB 2 (toc.ncx).
        val spineIndex = spine.withIndex().associate { it.value to it.index }
        var toc = emptyList<TocEntry>()
        items.firstOrNull { it.props.split(' ').contains("nav") }?.let { nav ->
            toc = parseNav(File(root, nav.path), nav.path, spineIndex)
        }
        if (toc.isEmpty()) {
            val ncxId = spineEl?.attr("toc").orEmpty()
            val ncx = byId[ncxId] ?: items.firstOrNull { it.mediaType == "application/x-dtbncx+xml" }
            if (ncx != null && File(root, ncx.path).exists()) {
                toc = parseNcx(File(root, ncx.path), ncx.path, spineIndex)
            }
        }
        val hiddenIdx = hidden.map { spineIndex[it] }.toSet()
        toc = toc.filter { e -> hiddenIdx.none { e.anchor.startsWith("s${it}_") } }
        return EpubBook(title, spine, toc, styles, hidden)
    }

    /**
     * A capa é o primeiro arquivo da leitura quando ele tem nome/id de capa (capa, cover, titlepage)
     * ou quando não tem texto nenhum, só uma imagem. Nunca esconde se o livro tiver um arquivo só.
     */
    private fun detectCover(root: File, spineEl: Element?, idToPath: Map<String, String>, spine: List<String>): Set<String> {
        if (spine.size < 2) return emptySet()
        val first = spine[0]
        val firstRef = spineEl?.children()?.firstOrNull { localName(it) == "itemref" }
        val idref = firstRef?.attr("idref").orEmpty()
        val named = Regex("(^|[^a-z])(capa|cover|titlepage)([^a-z]|$)", RegexOption.IGNORE_CASE)
        if (named.containsMatchIn(idref) || named.containsMatchIn(first.substringAfterLast('/'))) return setOf(first)
        return try {
            val doc = Jsoup.parse(File(root, first).readText(), "", Parser.xmlParser())
            val body = doc.select("*").firstOrNull { localName(it) == "body" } ?: return emptySet()
            val images = body.select("*").count { localName(it) == "img" || localName(it) == "image" }
            if (body.text().isBlank() && images in 1..1) setOf(first) else emptySet()
        } catch (_: Exception) { emptySet() }
    }

    private fun parseNav(file: File, path: String, spineIndex: Map<String, Int>): List<TocEntry> {
        val doc = Jsoup.parse(file.readText(), "", Parser.xmlParser())
        val nav = doc.select("*").firstOrNull { localName(it) == "nav" && it.attr("epub:type").contains("toc") }
            ?: doc.select("*").firstOrNull { localName(it) == "nav" } ?: return emptyList()
        val out = mutableListOf<TocEntry>()
        fun walk(list: Element, level: Int) {
            for (li in list.children().filter { localName(it) == "li" }) {
                val a = li.children().firstOrNull { localName(it) == "a" }
                if (a != null) {
                    val anchor = anchorFor(parentOf(path), a.attr("href"), spineIndex)
                    val t = a.text().trim()
                    if (anchor != null && t.isNotEmpty()) out += TocEntry(t, anchor, level)
                }
                li.children().filter { localName(it) == "ol" || localName(it) == "ul" }.forEach { walk(it, level + 1) }
            }
        }
        nav.children().filter { localName(it) == "ol" || localName(it) == "ul" }.forEach { walk(it, 1) }
        return out
    }

    private fun parseNcx(file: File, path: String, spineIndex: Map<String, Int>): List<TocEntry> {
        val doc = Jsoup.parse(file.readText(), "", Parser.xmlParser())
        val navMap = doc.select("*").firstOrNull { localName(it) == "navMap" } ?: return emptyList()
        val out = mutableListOf<TocEntry>()
        fun walk(parent: Element, level: Int) {
            for (np in parent.children().filter { localName(it) == "navPoint" }) {
                val label = np.select("*").firstOrNull { localName(it) == "text" }?.text()?.trim().orEmpty()
                val src = np.children().firstOrNull { localName(it) == "content" }?.attr("src").orEmpty()
                val anchor = anchorFor(parentOf(path), src, spineIndex)
                if (anchor != null && label.isNotEmpty()) out += TocEntry(label, anchor, level)
                walk(np, level + 1)
            }
        }
        walk(navMap, 1)
        return out
    }

    // ---------- utilitários de caminho ----------

    internal fun localName(e: Element): String = e.tagName().substringAfter(':')

    internal fun parentOf(path: String): String = path.substringBeforeLast('/', "")

    /** Resolve [href] (relativo ao diretório [baseDir]) para um caminho a partir da raiz do EPUB. */
    internal fun resolve(baseDir: String, href: String): String {
        val clean = decode(href.substringBefore('#').substringBefore('?'))
        if (clean.isEmpty()) return ""
        val parts = ArrayList<String>()
        if (!clean.startsWith("/")) baseDir.split('/').filter { it.isNotEmpty() }.forEach { parts += it }
        for (seg in clean.split('/')) {
            when (seg) {
                "", "." -> {}
                ".." -> if (parts.isNotEmpty()) parts.removeAt(parts.size - 1)
                else -> parts += seg
            }
        }
        return parts.joinToString("/")
    }

    private fun decode(s: String): String = try {
        URLDecoder.decode(s.replace("+", "%2B"), "UTF-8")
    } catch (_: Exception) { s }

    internal fun isExternal(href: String): Boolean {
        val h = href.trim().lowercase()
        return h.startsWith("http:") || h.startsWith("https:") || h.startsWith("mailto:") || h.startsWith("tel:") ||
            (h.contains(':') && !h.startsWith("#") && runCatching { URI(href).scheme != null }.getOrDefault(false))
    }

    /** Converte um link (arquivo#frag) no id usado no documento de leitura montado. */
    internal fun anchorFor(baseDir: String, href: String, spineIndex: Map<String, Int>, currentFile: String? = null): String? {
        if (href.isBlank() || isExternal(href)) return null
        val frag = href.substringAfter('#', "").let { decode(it) }
        val filePart = href.substringBefore('#')
        val file = if (filePart.isEmpty()) currentFile ?: return null else resolve(baseDir, filePart)
        val idx = spineIndex[file] ?: return null
        return if (frag.isEmpty()) "s${idx}__top" else "s${idx}_$frag"
    }
}

/**
 * Monta um único documento HTML (rolagem contínua) com todos os arquivos de texto do EPUB.
 * Os ids recebem o prefixo "s<n>_" para não colidirem e os links internos são reescritos.
 */
object ReaderHtmlBuilder {

    /** Endereço onde o leitor (JS/CSS do app) é servido dentro da WebView. */
    const val ASSETS_BASE = "https://appassets.androidplatform.net/assets/reader/"

    /** [appearanceJson]: aparência inicial (JSON) aplicada antes da primeira pintura da página. */
    fun build(root: File, book: EpubBook, appearanceJson: String? = null, marcasJson: String? = null): String {
        val spineIndex = book.spine.withIndex().associate { it.value to it.index }
        val sb = StringBuilder()
        sb.append("<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"/>")
        sb.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>")
        sb.append("<title>").append(Entities.escape(book.title)).append("</title>")
        for (css in book.stylesheets) {
            sb.append("<link rel=\"stylesheet\" href=\"").append(Entities.escape(urlPath(css))).append("\"/>")
        }
        sb.append("<link rel=\"stylesheet\" href=\"${ASSETS_BASE}reader.css\"/>")
        if (appearanceJson != null) {
            // "</" não pode aparecer dentro do <script>
            sb.append("<script>window.LEITOR_APARENCIA=").append(appearanceJson.replace("</", "<\\/")).append(";</script>")
        }
        if (marcasJson != null) {
            sb.append("<script>window.LEITOR_MARCAS=").append(marcasJson.replace("</", "<\\/")).append(";</script>")
        }
        sb.append("</head><body><div id=\"content\">")

        for ((n, path) in book.spine.withIndex()) {
            if (path in book.hidden) continue
            val dir = EpubParser.parentOf(path)
            val doc = parseXhtml(File(root, path).readText())
            val body = doc.body()
            body.select("script, iframe, object, embed, form, input, button").remove()
            // atributos de evento (onclick etc.) não são permitidos
            body.select("*").forEach { el ->
                el.attributes().asList().map { it.key }.filter { it.lowercase().startsWith("on") }.forEach { el.removeAttr(it) }
            }
            body.select("[id]").forEach { it.attr("id", "s${n}_" + it.id()) }
            body.select("a[name]").forEach { if (!it.hasAttr("id")) it.attr("id", "s${n}_" + it.attr("name")) }
            for (a in body.select("a[href]")) {
                val href = a.attr("href")
                if (EpubParser.isExternal(href)) {
                    a.attr("data-external", "1")
                    continue
                }
                val anchor = EpubParser.anchorFor(dir, href, spineIndex, currentFile = path)
                if (anchor != null) a.attr("href", "#$anchor") else a.removeAttr("href")
            }
            for (img in body.select("img[src]")) img.attr("src", urlPath(EpubParser.resolve(dir, img.attr("src"))))
            for (img in body.select("image")) {
                for (key in listOf("xlink:href", "href")) {
                    if (img.hasAttr(key)) img.attr(key, urlPath(EpubParser.resolve(dir, img.attr(key))))
                }
            }
            for (src in body.select("source[src], audio[src], video[src]")) src.attr("src", urlPath(EpubParser.resolve(dir, src.attr("src"))))

            val cls = (body.className() + " epub-sec").trim()
            sb.append("<section class=\"").append(Entities.escape(cls)).append("\" id=\"s${n}__top\">")
            sb.append(body.html())
            sb.append("</section>")
        }
        sb.append("</div>")
        sb.append("<script src=\"${ASSETS_BASE}reader.js\"></script>")
        sb.append("</body></html>")
        return sb.toString()
    }

    /** Lê XHTML com o parser XML (respeita <p/> etc.) e converte para um documento HTML. */
    internal fun parseXhtml(text: String): Document {
        val xml = Jsoup.parse(text, "", Parser.xmlParser())
        xml.outputSettings().syntax(Document.OutputSettings.Syntax.xml).prettyPrint(false)
        val bodyXml = xml.select("*").firstOrNull { EpubParser.localName(it) == "body" }
        val bodyClass = bodyXml?.attr("class").orEmpty()
        // Serializa os filhos do body como XML (tags vazias ficam <x></x> ou <br />) e relê como HTML.
        val inner = bodyXml?.childNodes()?.joinToString("") { node ->
            if (node is Element) fixEmpty(node) else Unit
            node.outerHtml()
        } ?: xml.html()
        val html = Jsoup.parseBodyFragment(inner)
        html.outputSettings().prettyPrint(false)
        if (bodyClass.isNotEmpty()) html.body().addClass(bodyClass)
        return html
    }

    private val VOID = setOf("br", "hr", "img", "meta", "link", "input", "col", "area", "base", "wbr", "source", "param", "embed", "track")

    /** Elementos não-vazios escritos como <x/> no XHTML precisam virar <x></x> para o HTML. */
    private fun fixEmpty(root: Element) {
        for (el in root.select("*")) {
            val name = EpubParser.localName(el).lowercase()
            if (el.childNodeSize() == 0 && name !in VOID) el.appendText("")
        }
    }

    /** Codifica um caminho para uso em URL (espaços, acentos), mantendo as barras. */
    internal fun urlPath(path: String): String =
        path.split('/').joinToString("/") { seg ->
            java.net.URLEncoder.encode(seg, "UTF-8").replace("+", "%20")
        }
}
