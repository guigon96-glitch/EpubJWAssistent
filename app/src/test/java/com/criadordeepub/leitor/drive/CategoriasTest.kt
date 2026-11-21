package com.criadordeepub.leitor.drive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CategoriasTest {

    private fun arq(id: String, nome: String, mod: String, vararg pais: String) =
        Categorias.Arquivo(id, nome, mod, 100, pais.toList())

    @Test
    fun ordem_padrao_primeiro_depois_alfabetica() {
        val r = Categorias.ordenar(listOf("Zacarias", "Outros", "Assembleias", "Ética", "discursos públicos", "Estudo"))
        assertEquals(
            listOf("Discursos Públicos", "Tesouros da Palavra de Deus", "Outros", "Assembleias", "Estudo", "Ética", "Zacarias"),
            r,
        )
    }

    @Test
    fun padrao_sempre_aparece_mesmo_sem_pastas() {
        assertEquals(Categorias.PADRAO, Categorias.ordenar(emptyList()))
    }

    @Test
    fun agrupa_por_subpasta_e_soltos_na_raiz_vao_para_outros() {
        val raiz = "R"
        val pastas = listOf(
            Categorias.Pasta("A", "Discursos Públicos"),
            Categorias.Pasta("B", "Tesouros da Palavra de Deus"),
            Categorias.Pasta("C", "outros"),       // nome com caixa diferente
            Categorias.Pasta("D", "Assembleias"),
        )
        val arquivos = listOf(
            arq("1", "Nº 132 Ressurreição.epub", "2026-11-10T10:00:00.000Z", "A"),
            arq("2", "Antigo solto.epub", "2026-01-01T10:00:00.000Z", raiz),
            arq("3", "Tesouros semana.epub", "2026-11-15T10:00:00.000Z", "B"),
            arq("4", "Em outros.epub", "2026-11-12T10:00:00.000Z", "C"),
            arq("5", "Assembleia.epub", "2026-11-11T10:00:00.000Z", "D"),
            arq("6", "Fora da pasta.epub", "2026-11-16T10:00:00.000Z", "XYZ"),
        )
        val r = Categorias.agrupar(setOf(raiz), pastas, arquivos).associate { it.arquivo.id to it.categoria }
        assertEquals("Discursos Públicos", r["1"])
        assertEquals("Outros", r["2"])
        assertEquals("Tesouros da Palavra de Deus", r["3"])
        assertEquals("Outros", r["4"])
        assertEquals("Assembleias", r["5"])
        assertFalse(r.containsKey("6"))
        // mais recentes primeiro
        assertEquals(listOf("3", "4", "5", "1", "2"), Categorias.agrupar(setOf(raiz), pastas, arquivos).map { it.arquivo.id })
    }

    @Test
    fun arquivo_movido_muda_de_categoria_pelo_pai() {
        val pastas = listOf(Categorias.Pasta("A", "Discursos Públicos"), Categorias.Pasta("B", "Outros"))
        val antes = Categorias.agrupar(setOf("R"), pastas, listOf(arq("1", "X.epub", "t", "A"))).single()
        val depois = Categorias.agrupar(setOf("R"), pastas, listOf(arq("1", "X renomeado.epub", "t2", "B"))).single()
        assertEquals("Discursos Públicos", antes.categoria)
        assertEquals("Outros", depois.categoria)
        assertEquals("1", depois.arquivo.id)
    }

    @Test
    fun epub_titulo_e_busca() {
        assertTrue(Categorias.ehEpub("x.EPUB", "application/octet-stream"))
        assertTrue(Categorias.ehEpub("sem extensão", "application/epub+zip"))
        assertFalse(Categorias.ehEpub("nota.txt", "text/plain"))
        assertEquals("Nº 132 Ressurreição", Categorias.titulo("Nº 132 Ressurreição.epub"))
        assertTrue(Categorias.combina("Nº 132 Ressurreição", "ressurreicao"))
        assertTrue(Categorias.combina("Nº 132 Ressurreição", "132"))
        assertFalse(Categorias.combina("Nº 132 Ressurreição", "batismo"))
    }
}
