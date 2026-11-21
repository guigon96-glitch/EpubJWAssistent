package com.criadordeepub.leitor.drive

import java.text.Collator
import java.text.Normalizer
import java.util.Locale

/**
 * Regras de categorias, iguais às do programa do PC:
 * categoria = subpasta da pasta "Criador de EPUB"; EPUBs soltos na pasta raiz vão para "Outros".
 */
object Categorias {
    const val DISCURSOS = "Discursos Públicos"
    const val TESOUROS = "Tesouros da Palavra de Deus"
    const val OUTROS = "Outros"
    val PADRAO = listOf(DISCURSOS, TESOUROS, OUTROS)

    data class Pasta(val id: String, val nome: String)
    data class Arquivo(val id: String, val name: String, val modifiedTime: String, val size: Long, val parents: List<String>)
    data class ComCategoria(val arquivo: Arquivo, val categoria: String)

    /** As 3 categorias padrão primeiro (nessa ordem), depois as outras em ordem alfabética. */
    fun ordenar(nomes: Collection<String>): List<String> {
        val collator = Collator.getInstance(Locale.forLanguageTag("pt-BR")).apply { strength = Collator.PRIMARY }
        val outras = nomes.filter { n -> PADRAO.none { igual(it, n) } }
            .distinctBy { chave(it) }
            .sortedWith { a, b -> collator.compare(a, b) }
        return PADRAO + outras
    }

    /**
     * Decide a categoria de cada EPUB pelo pai no Drive: subpasta → nome dela; pasta raiz → "Outros".
     * Os EPUBs ficam do mais alterado recentemente para o mais antigo.
     */
    fun agrupar(raizes: Set<String>, subpastas: List<Pasta>, arquivos: List<Arquivo>): List<ComCategoria> {
        val porId = subpastas.associateBy { it.id }
        return arquivos.mapNotNull { a ->
            val cat = a.parents.firstNotNullOfOrNull { porId[it]?.nome?.let(::normalizarNomePadrao) }
                ?: if (a.parents.any { it in raizes }) OUTROS else null
            cat?.let { ComCategoria(a, it) }
        }.distinctBy { it.arquivo.id }
            .sortedByDescending { it.arquivo.modifiedTime }
    }

    fun ehEpub(name: String, mimeType: String) =
        mimeType == "application/epub+zip" || name.lowercase(Locale.ROOT).endsWith(".epub")

    /** Título para mostrar: nome do arquivo sem ".epub". */
    fun titulo(nome: String) = if (nome.lowercase(Locale.ROOT).endsWith(".epub")) nome.dropLast(5) else nome

    /** Busca por título ignorando maiúsculas e acentos. */
    fun combina(titulo: String, busca: String): Boolean {
        val q = chave(busca)
        return q.isEmpty() || chave(titulo).contains(q)
    }

    private fun normalizarNomePadrao(n: String) = PADRAO.firstOrNull { igual(it, n) } ?: n.trim()
    private fun igual(a: String, b: String) = chave(a) == chave(b)
    private fun chave(s: String) =
        Normalizer.normalize(s.trim(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT)
}
