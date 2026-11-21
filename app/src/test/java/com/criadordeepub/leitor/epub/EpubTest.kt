package com.criadordeepub.leitor.epub

import org.jsoup.Jsoup
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class EpubTest {

    companion object {
        fun zip(files: Map<String, String>): ByteArray {
            val bos = ByteArrayOutputStream()
            ZipOutputStream(bos).use { z ->
                // mimetype primeiro e sem compressão, como manda a especificação
                val mt = "application/epub+zip".toByteArray()
                val e = ZipEntry("mimetype").apply {
                    method = ZipEntry.STORED; size = mt.size.toLong(); compressedSize = mt.size.toLong()
                    crc = CRC32().apply { update(mt) }.value
                }
                z.putNextEntry(e); z.write(mt); z.closeEntry()
                for ((name, body) in files) {
                    z.putNextEntry(ZipEntry(name)); z.write(body.toByteArray()); z.closeEntry()
                }
            }
            return bos.toByteArray()
        }

        const val CONTAINER = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

        /** EPUB no mesmo formato gerado pelo Criador de EPUB (PC). */
        fun criadorEpub(): ByteArray = zip(
            mapOf(
                "META-INF/container.xml" to CONTAINER,
                "OEBPS/content.opf" to """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:1234</dc:identifier>
    <dc:title>Discurso 132</dc:title>
    <dc:language>pt-BR</dc:language>
  </metadata>
  <manifest>
    <item id="capa" href="capa.xhtml" media-type="application/xhtml+xml"/>
    <item id="texto" href="texto.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="img1" href="images/foto 1.svg" media-type="image/svg+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="capa"/><itemref idref="texto"/></spine>
</package>""",
                "OEBPS/capa.xhtml" to """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capa</title></head>
<body><div class="capa"><img src="images/foto%201.svg" alt="capa"/></div></body></html>""",
                "OEBPS/texto.xhtml" to """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="pt-BR">
<head><meta charset="utf-8"/><title>Discurso 132</title><link rel="stylesheet" href="style.css"/></head>
<body>
<h1 id="h1">Vença o medo da morte</h1>
<p>Introdução.</p>
<h2 id="h2">A esperança</h2>
<p>Leia <a href="#fn1" id="r1" class="noteref" epub:type="noteref">Isaías 25:8</a> e pense.</p>
<p class="img"><img src="images/foto%201.svg" style="width: 50%" alt=""/></p>
<div class="vazio"/>
<h3 id="h3">Conclusão</h3>
<p>Fim.</p>
<div class="footnotes" epub:type="endnotes"><h3>Notas</h3>
<p id="fn1" class="nota" epub:type="endnote">Isaías 25:8 (Tradução do Novo Mundo): "8 Ele acabará com a morte para sempre,<br />e o Soberano Senhor Jeová enxugará as lágrimas de todas as faces." <a href="#r1">↩</a></p>
</div>
</body></html>""",
                "OEBPS/nav.xhtml" to """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head>
<body><nav epub:type="toc" id="toc"><h1>Sumário</h1><ol>
<li><a href="texto.xhtml#h1">Vença o medo da morte</a><ol>
  <li><a href="texto.xhtml#h2">A esperança</a><ol><li><a href="texto.xhtml#h3">Conclusão</a></li></ol></li>
</ol></li></ol></nav></body></html>""",
                "OEBPS/toc.ncx" to """<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Discurso 132</text></docTitle>
<navMap><navPoint id="n1" playOrder="1"><navLabel><text>Vença o medo da morte</text></navLabel><content src="texto.xhtml#h1"/></navPoint></navMap></ncx>""",
                "OEBPS/style.css" to "body { font-family: serif; } .nota { font-size: 0.9em; }",
                "OEBPS/images/foto 1.svg" to """<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#3E7BB5"/></svg>""",
            )
        )

        /** EPUB 2 no estilo do Calibre: vários arquivos e notas num arquivo separado. */
        fun calibreEpub(): ByteArray = zip(
            mapOf(
                "META-INF/container.xml" to """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>""",
                "content.opf" to """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Livro do Calibre</dc:title>
  </metadata>
  <manifest>
    <item href="text/part0000.html" id="p0" media-type="application/xhtml+xml"/>
    <item href="text/part0001.html" id="p1" media-type="application/xhtml+xml"/>
    <item href="stylesheet.css" id="css" media-type="text/css"/>
    <item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="p0"/><itemref idref="p1"/></spine>
</package>""",
                "text/part0000.html" to """<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head>
<body class="calibre">
<h2 class="calibre3" id="cap1">Capítulo 1</h2>
<p class="calibre1">Texto com nota<a href="part0001.html#fn1" id="r1" class="calibre2"><sup>1</sup></a> e outra <a id="r2" href="part0001.html#fn2">[2]</a>.</p>
<p class="calibre1">Vá para o <a href="part0001.html#cap2">capítulo 2</a>.</p>
<p class="calibre1">Site: <a href="https://www.exemplo.org/">exemplo</a></p>
<p/>
<script>alert(1)</script>
<p onclick="alert(2)">Fim do capítulo 1.</p>
</body></html>""",
                "text/part0001.html" to """<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head>
<body class="calibre">
<h2 class="calibre3" id="cap2">Capítulo 2</h2>
<p class="calibre1">Texto.</p>
<p class="calibre1" id="fn1"><a href="part0000.html#r1">1</a>. Primeira nota&#160;com entidade.</p>
<p class="calibre1"><a id="fn2" href="part0000.html#r2">2</a>. Segunda nota.</p>
</body></html>""",
                "stylesheet.css" to ".calibre { display: block; }",
                "toc.ncx" to """<?xml version='1.0' encoding='utf-8'?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Livro</text></docTitle>
<navMap>
<navPoint id="a" playOrder="1"><navLabel><text>Capítulo 1</text></navLabel><content src="text/part0000.html"/>
  <navPoint id="b" playOrder="2"><navLabel><text>Seção</text></navLabel><content src="text/part0000.html#cap1"/></navPoint>
</navPoint>
<navPoint id="c" playOrder="3"><navLabel><text>Capítulo 2</text></navLabel><content src="text/part0001.html#cap2"/></navPoint>
</navMap></ncx>""",
            )
        )

        fun extracted(bytes: ByteArray): File {
            val dir = Files.createTempDirectory("epub").toFile()
            EpubExtractor.extract(ByteArrayInputStream(bytes), dir)
            return dir
        }
    }

    @Test
    fun criador_parse_spine_toc_title() {
        val dir = extracted(criadorEpub())
        val book = EpubParser.parse(dir)
        assertEquals("Discurso 132", book.title)
        assertEquals(listOf("OEBPS/capa.xhtml", "OEBPS/texto.xhtml"), book.spine)
        assertEquals(listOf("OEBPS/style.css"), book.stylesheets)
        assertEquals(setOf("OEBPS/capa.xhtml"), book.hidden)
        assertEquals(
            listOf(TocEntry("Vença o medo da morte", "s1_h1", 1), TocEntry("A esperança", "s1_h2", 2), TocEntry("Conclusão", "s1_h3", 3)),
            book.toc
        )
    }

    @Test
    fun criador_html_notes_images_and_links() {
        val dir = extracted(criadorEpub())
        val html = ReaderHtmlBuilder.build(dir, EpubParser.parse(dir))
        val doc = Jsoup.parse(html)

        val ref = doc.getElementById("s1_r1")!!
        assertEquals("#s1_fn1", ref.attr("href"))
        assertEquals("noteref", ref.attr("epub:type"))

        val nota = doc.getElementById("s1_fn1")!!
        assertEquals("endnote", nota.attr("epub:type"))
        assertTrue(nota.text().contains("Ele acabará com a morte"))
        assertEquals(1, nota.select("br").size) // quebra de linha do versículo preservada
        assertEquals("#s1_r1", nota.selectFirst("a")!!.attr("href"))

        // imagem com largura em % e caminho com espaço codificado
        val img = doc.select("section#s1__top img").first()!!
        assertEquals("width: 50%", img.attr("style"))
        assertEquals("OEBPS/images/foto%201.svg", img.attr("src"))
        assertTrue(File(dir, "OEBPS/images/foto 1.svg").exists())

        // <div/> vazio não pode "engolir" o resto do texto
        val vazio = doc.selectFirst("div.vazio")!!
        assertEquals(0, vazio.childrenSize())
        assertEquals("s1_h3", doc.selectFirst("h3")!!.id())

        assertNotNull(doc.selectFirst("link[href=OEBPS/style.css]"))
        // a capa não aparece no leitor: a primeira coisa é o título do discurso
        assertTrue(doc.select("section#s0__top").isEmpty())
        assertEquals(listOf("s1__top"), doc.select("section.epub-sec").map { it.id() })
        assertNotNull(doc.selectFirst("script[src\$=reader.js]"))
    }

    @Test
    fun calibre_cross_file_notes_toc_and_safety() {
        val dir = extracted(calibreEpub())
        val book = EpubParser.parse(dir)
        assertEquals("Livro do Calibre", book.title)
        assertEquals(
            listOf(TocEntry("Capítulo 1", "s0__top", 1), TocEntry("Seção", "s0_cap1", 2), TocEntry("Capítulo 2", "s1_cap2", 1)),
            book.toc
        )
        val doc = Jsoup.parse(ReaderHtmlBuilder.build(dir, book))
        assertEquals("#s1_fn1", doc.getElementById("s0_r1")!!.attr("href"))
        assertEquals("#s1_fn2", doc.getElementById("s0_r2")!!.attr("href"))
        assertEquals("#s0_r1", doc.getElementById("s1_fn1")!!.selectFirst("a")!!.attr("href"))
        assertEquals("#s1_cap2", doc.select("a:contains(capítulo 2)").attr("href"))
        assertTrue(doc.getElementById("s1_fn1")!!.html().contains("nota&nbsp;com entidade"))
        // links externos marcados; scripts e eventos removidos
        assertEquals("1", doc.select("a[href^=https]").attr("data-external"))
        assertEquals(1, doc.select("script").size) // só o reader.js do app
        assertTrue(doc.select("[onclick]").isEmpty())
        assertTrue(book.hidden.isEmpty()) // primeiro arquivo tem texto: não é capa
        // os dois capítulos na ordem
        assertEquals(listOf("s0__top", "s1__top"), doc.select("section.epub-sec").map { it.id() })
        assertTrue(doc.select("section").first()!!.hasClass("calibre"))
    }

    @Test
    fun extractor_blocks_zip_slip() {
        val evil = zip(mapOf("../fora.txt" to "x", "ok/dentro.txt" to "y"))
        val dir = Files.createTempDirectory("epub").toFile()
        EpubExtractor.extract(ByteArrayInputStream(evil), File(dir, "livro"))
        assertFalse(File(dir, "fora.txt").exists())
        assertTrue(File(dir, "livro/ok/dentro.txt").exists())
    }

    @Test
    fun cover_only_image_without_name_is_hidden_but_single_file_never() {
        val opf = { spine: String -> """<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
<manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine>$spine</spine></package>""" }
        val img = """<html xmlns="http://www.w3.org/1999/xhtml"><body><div><img src="x.png"/></div></body></html>"""
        val txt = """<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Texto</p></body></html>"""
        val two = extracted(zip(mapOf("META-INF/container.xml" to CONTAINER, "OEBPS/content.opf" to opf("<itemref idref=\"a\"/><itemref idref=\"b\"/>"), "OEBPS/a.xhtml" to img, "OEBPS/b.xhtml" to txt)))
        assertEquals(setOf("OEBPS/a.xhtml"), EpubParser.parse(two).hidden)
        val one = extracted(zip(mapOf("META-INF/container.xml" to CONTAINER, "OEBPS/content.opf" to opf("<itemref idref=\"a\"/>"), "OEBPS/a.xhtml" to img)))
        assertTrue(EpubParser.parse(one).hidden.isEmpty())
    }

    @Test
    fun resolve_paths() {
        assertEquals("OEBPS/images/a.jpg", EpubParser.resolve("OEBPS/text", "../images/a.jpg"))
        assertEquals("a b.jpg", EpubParser.resolve("", "a%20b.jpg"))
        assertEquals("x/y.html", EpubParser.resolve("x", "y.html#frag"))
    }

    /** Gera as páginas de leitura para o teste no navegador (Chromium/Playwright). */
    @Test
    fun write_fixtures_for_browser_test() {
        val out = File("build/leitor-fixtures").apply { mkdirs() }
        for ((name, bytes) in listOf("criador" to criadorEpub(), "calibre" to calibreEpub())) {
            val dir = File(out, name)
            EpubExtractor.extract(ByteArrayInputStream(bytes), dir)
            File(dir, "__leitor.html").writeText(ReaderHtmlBuilder.build(dir, EpubParser.parse(dir)))
        }
    }
}
