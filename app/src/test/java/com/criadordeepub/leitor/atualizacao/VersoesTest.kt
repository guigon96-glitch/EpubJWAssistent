package com.criadordeepub.leitor.atualizacao

import com.criadordeepub.leitor.atualizacao.Versoes.Arquivo
import com.criadordeepub.leitor.atualizacao.Versoes.Publicacao
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VersoesTest {

    private fun pub(tag: String, vararg arquivos: String, rascunho: Boolean = false, pre: Boolean = false) =
        Publicacao(tag, rascunho, pre, "notas $tag", arquivos.map { Arquivo(it, "https://x/$it", 10) })

    private val lista = listOf(
        pub("v1.8.1", "Instalar-Criador-de-EPUB-1.8.1.exe"),            // PC: ignorar
        pub("android-v1.3", "Leitor-de-Discursos-1.3.apk", "Leitor-de-Discursos-1.3.apk.sha256"),
        pub("android-v1.10", "Leitor-de-Discursos-1.10.apk", "Leitor-de-Discursos-1.10.apk.sha256"),
        pub("android-v1.9", "Leitor-de-Discursos-1.9.apk"),
        pub("android-v2.0", "Leitor-de-Discursos-2.0.apk", rascunho = true),  // rascunho: ignorar
        pub("android-v1.11", "codigo.zip"),                              // sem APK: ignorar
        pub("android-v3.0", "Leitor-de-Discursos-3.0.apk", pre = true),  // pré-lançamento: ignorar
    )

    @Test
    fun compara_versoes_numericamente() {
        assertTrue(Versoes.comparar("1.10", "1.9") > 0)
        assertTrue(Versoes.comparar("1.4", "1.3") > 0)
        assertEquals(0, Versoes.comparar("1.4", "1.4.0"))
        assertTrue(Versoes.comparar("2.0", "1.99.9") > 0)
        assertTrue(Versoes.comparar("1.3", "1.3.1") < 0)
    }

    @Test
    fun escolhe_a_maior_versao_do_tablet() {
        val a = Versoes.escolher(lista, "1.3")!!
        assertEquals("1.10", a.versao)
        assertEquals("Leitor-de-Discursos-1.10.apk", a.apk.nome)
        assertEquals("Leitor-de-Discursos-1.10.apk.sha256", a.sha256?.nome)
    }

    @Test
    fun sem_atualizacao_quando_ja_esta_na_mais_nova() {
        assertNull(Versoes.escolher(lista, "1.10"))
        assertNull(Versoes.escolher(lista, "1.12"))
        assertNull(Versoes.escolher(emptyList(), "1.0"))
    }

    @Test
    fun versao_do_pc_nunca_e_oferecida() {
        assertNull(Versoes.escolher(listOf(pub("v9.9.9", "Instalar.exe", "algo.apk")), "1.0"))
    }

    @Test
    fun notas_e_sha() {
        val n = Versoes.notasSimples("## Novidades\n- **Botão** Atualizar app\n- Veja [aqui](http://x) e *itálico*\n\n\n\nFim")
        assertEquals("Novidades\n• Botão Atualizar app\n• Veja aqui e itálico\n\nFim", n)
        assertEquals(
            "3204f56f12e08107cc7f9e9ea72694252c53e273b2967ef177991ad0ab1e847e",
            Versoes.lerSha256("3204F56F12E08107CC7F9E9EA72694252C53E273B2967EF177991AD0AB1E847E  Leitor-de-Discursos-1.3.apk\n"),
        )
        assertNull(Versoes.lerSha256("nada aqui"))
    }
}
