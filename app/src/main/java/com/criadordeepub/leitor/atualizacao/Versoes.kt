package com.criadordeepub.leitor.atualizacao

/**
 * Regras puras (sem Android) para achar a atualização do app do tablet entre as versões
 * publicadas no GitHub. As versões do tablet têm a etiqueta "android-vX.Y[.Z]"; as do
 * programa do PC ("vX.Y.Z") são ignoradas.
 */
object Versoes {
    const val PREFIXO = "android-v"

    data class Arquivo(val nome: String, val url: String, val tamanho: Long)
    data class Publicacao(val tag: String, val rascunho: Boolean, val preLancamento: Boolean, val notas: String, val arquivos: List<Arquivo>)
    data class Atualizacao(val versao: String, val notas: String, val apk: Arquivo, val sha256: Arquivo?)

    /** Compara "1.10" com "1.9" numericamente (1.10 é maior). Partes que faltam valem 0. */
    fun comparar(a: String, b: String): Int {
        val pa = partes(a)
        val pb = partes(b)
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val c = pa.getOrElse(i) { 0 }.compareTo(pb.getOrElse(i) { 0 })
            if (c != 0) return c
        }
        return 0
    }

    private fun partes(v: String): List<Int> =
        v.trim().removePrefix("v").split('.', '-', '+').takeWhile { it.isNotEmpty() && it.all(Char::isDigit) }.map { it.toInt() }

    /** A versão mais nova do tablet que seja maior que [atual] e tenha um APK; ou null. */
    fun escolher(publicacoes: List<Publicacao>, atual: String): Atualizacao? =
        publicacoes.asSequence()
            .filter { !it.rascunho && !it.preLancamento && it.tag.startsWith(PREFIXO) }
            .mapNotNull { p ->
                val versao = p.tag.removePrefix(PREFIXO)
                val apk = p.arquivos.firstOrNull { it.nome.endsWith(".apk", ignoreCase = true) } ?: return@mapNotNull null
                if (partes(versao).isEmpty()) return@mapNotNull null
                Atualizacao(versao, p.notas, apk, p.arquivos.firstOrNull { it.nome.equals(apk.nome + ".sha256", ignoreCase = true) })
            }
            .filter { comparar(it.versao, atual) > 0 }
            .maxWithOrNull { x, y -> comparar(x.versao, y.versao) }

    /** Notas da versão sem a marcação Markdown, para mostrar numa janela simples. */
    fun notasSimples(md: String, limite: Int = 900): String {
        val t = md.lines().joinToString("\n") { l ->
            l.replace(Regex("^#{1,6}\\s*"), "")
                .replace(Regex("^\\s*[-*]\\s+"), "• ")
                .replace("**", "").replace("`", "")
                .replace(Regex("\\[([^]]+)]\\([^)]+\\)"), "$1")
                .replace(Regex("(?<![\\w*])\\*([^*]+)\\*(?![\\w*])"), "$1")
        }.replace(Regex("\n{3,}"), "\n\n").trim()
        return if (t.length > limite) t.take(limite).trimEnd() + "…" else t
    }

    /** Lê o SHA-256 de um arquivo ".sha256" (formato do sha256sum: "<hash>  <nome>"). */
    fun lerSha256(conteudo: String): String? =
        Regex("\\b([0-9a-fA-F]{64})\\b").find(conteudo)?.groupValues?.get(1)?.lowercase()
}
