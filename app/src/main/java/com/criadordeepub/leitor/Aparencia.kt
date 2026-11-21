package com.criadordeepub.leitor

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import org.json.JSONObject

/** Um tema do leitor, lido de assets/reader/temas.json (ou a cor personalizada). */
data class Tema(val id: String, val nome: String, val grupo: String, val escuro: Boolean, val fundo: Int, val texto: Int, val json: JSONObject)

object Temas {
    const val PERSONALIZADO = "personalizado"
    val GRUPOS = listOf("Claros", "Texturas", "Escuros")

    @Volatile private var cache: List<Tema>? = null

    fun all(c: Context): List<Tema> = cache ?: synchronized(this) {
        cache ?: c.assets.open("reader/temas.json").bufferedReader().use { it.readText() }.let { txt ->
            val arr = JSONObject(txt).getJSONArray("temas")
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Tema(
                    o.getString("id"), o.optString("nome", o.getString("id")), o.optString("grupo", "Claros"),
                    o.optBoolean("escuro", false), parse(o.optString("fundo"), Color.WHITE), parse(o.optString("texto"), Color.BLACK), o,
                )
            }
        }.also { cache = it }
    }

    fun byId(c: Context, id: String?): Tema? = all(c).firstOrNull { it.id == id }

    /** Monta o tema "Cor personalizada" a partir das cores escolhidas. */
    fun personalizado(fundo: Int, texto: Int): Tema {
        val escuro = luminance(fundo) < 0.35
        val o = JSONObject()
            .put("id", PERSONALIZADO).put("nome", "Personalizado").put("grupo", "Personalizado").put("escuro", escuro)
            .put("fundo", hex(fundo)).put("texto", hex(texto))
            .put("link", if (escuro) "#8AB4F8" else "#0B57D0")
            .put("popupFundo", hex(mix(fundo, if (escuro) Color.WHITE else Color.BLACK, 0.06)))
            .put("popupBorda", hex(mix(fundo, texto, 0.3)))
        return Tema(PERSONALIZADO, "Personalizado", "Personalizado", escuro, fundo, texto, o)
    }

    fun parse(s: String?, def: Int): Int = try { Color.parseColor(s) } catch (_: Exception) { def }
    fun hex(c: Int) = String.format("#%06X", 0xFFFFFF and c)
    fun luminance(c: Int) = (0.2126 * Color.red(c) + 0.7152 * Color.green(c) + 0.0722 * Color.blue(c)) / 255.0
    private fun mix(a: Int, b: Int, t: Double): Int = Color.rgb(
        (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt(),
    )
}

/**
 * Preferências de leitura (salvas no aparelho). Valores "original" mantêm o que o livro definiu.
 */
data class Aparencia(
    val tema: String = "branco",
    val temaClaro: String = "branco",
    val temaEscuro: String = "noite",
    val seguirSistema: Boolean = false,
    val corFundo: Int = Color.parseColor("#FFF8E7"),
    val corTexto: Int = Color.parseColor("#222222"),
    val tamanho: Int = 160,               // % (zoom do texto)
    val tamanhoApresentacao: Int = 220,   // % no modo apresentação
    val fonte: String = "original",       // original | serifada | sem-serifa | leitura-facil | mono
    val margemLateral: Int = 5,           // % da largura
    val margemVertical: Int = 2,          // % da largura
    val linhas: Int = 16,                 // espaço entre linhas x10 (16 = 1,6)
    val letras: Int = 0,                  // espaço entre letras em centésimos de em (-2 a 15)
    val paragrafo: String = "original",   // original | número em em
    val recuo: String = "original",       // original | número em em
    val alinhamento: String = "original", // original | justificado | esquerda
    val brilho: Float = -1f,              // -1 = automático
    val telaLigada: Boolean = true,
    val notaPosicao: String = "centro",   // balão da anotação: baixo | centro | movel
    val notaCor: String = "tema",         // cor das anotações: tema | vermelho | azul | verde | roxo | laranja
    val notaEstilo: String = "pontilhado", // pontilhado | sublinhado | fundo | negrito
) {
    fun toJson(): JSONObject = JSONObject()
        .put("tema", tema).put("temaClaro", temaClaro).put("temaEscuro", temaEscuro).put("seguirSistema", seguirSistema)
        .put("corFundo", corFundo).put("corTexto", corTexto)
        .put("tamanho", tamanho).put("tamanhoApresentacao", tamanhoApresentacao).put("fonte", fonte)
        .put("margemLateral", margemLateral).put("margemVertical", margemVertical)
        .put("linhas", linhas).put("letras", letras).put("paragrafo", paragrafo).put("recuo", recuo)
        .put("alinhamento", alinhamento).put("brilho", brilho.toDouble()).put("telaLigada", telaLigada)
        .put("notaPosicao", notaPosicao).put("notaCor", notaCor).put("notaEstilo", notaEstilo)

    /** Tema efetivo (considerando "seguir o modo escuro do sistema"). */
    fun temaAtivo(c: Context): Tema {
        val night = (c.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val id = if (seguirSistema) (if (night) temaEscuro else temaClaro) else tema
        if (id == Temas.PERSONALIZADO) return Temas.personalizado(corFundo, corTexto)
        return Temas.byId(c, id) ?: Temas.all(c).first()
    }

    /** Escolhe um tema e guarda também como "o claro" ou "o escuro" preferido. */
    fun comTema(t: Tema): Aparencia = copy(
        tema = t.id,
        temaClaro = if (!t.escuro) t.id else temaClaro,
        temaEscuro = if (t.escuro) t.id else temaEscuro,
    )

    /** JSON enviado para a página (reader.js → applyAppearance). */
    fun paraPagina(c: Context): String = JSONObject()
        .put("tema", temaAtivo(c).json)
        .put("fonte", fonte)
        .put("margemLateral", margemLateral).put("margemVertical", margemVertical)
        .put("linhas", linhas / 10.0).put("letras", letras / 100.0)
        .put("paragrafo", paragrafo).put("recuo", recuo).put("alinhamento", alinhamento)
        .put("notaPosicao", notaPosicao).put("notaCor", notaCor).put("notaEstilo", notaEstilo)
        .toString()

    companion object {
        private fun prefs(c: Context) = c.getSharedPreferences("leitor", Context.MODE_PRIVATE)

        fun load(c: Context): Aparencia {
            val p = prefs(c)
            val raw = p.getString("aparencia", null)
            if (raw == null) {
                // migra as preferências da versão 1.1 (zoom, tema claro/sépia/escuro, brilho)
                val old = p.getString("tema", null)
                val t = when (old) { "sepia" -> "sepia"; "dark" -> "noite"; else -> "branco" }
                return Aparencia(
                    tema = t, temaClaro = if (t == "noite") "branco" else t,
                    tamanho = p.getInt("zoom", 160), brilho = p.getFloat("brilho", -1f),
                )
            }
            return try {
                val o = JSONObject(raw)
                val d = Aparencia()
                Aparencia(
                    tema = o.optString("tema", d.tema), temaClaro = o.optString("temaClaro", d.temaClaro),
                    temaEscuro = o.optString("temaEscuro", d.temaEscuro), seguirSistema = o.optBoolean("seguirSistema", d.seguirSistema),
                    corFundo = o.optInt("corFundo", d.corFundo), corTexto = o.optInt("corTexto", d.corTexto),
                    tamanho = o.optInt("tamanho", d.tamanho), tamanhoApresentacao = o.optInt("tamanhoApresentacao", d.tamanhoApresentacao),
                    fonte = o.optString("fonte", d.fonte),
                    margemLateral = o.optInt("margemLateral", d.margemLateral), margemVertical = o.optInt("margemVertical", d.margemVertical),
                    linhas = o.optInt("linhas", d.linhas), letras = o.optInt("letras", d.letras),
                    paragrafo = o.optString("paragrafo", d.paragrafo), recuo = o.optString("recuo", d.recuo),
                    alinhamento = o.optString("alinhamento", d.alinhamento),
                    brilho = o.optDouble("brilho", d.brilho.toDouble()).toFloat(), telaLigada = o.optBoolean("telaLigada", d.telaLigada),
                    notaPosicao = o.optString("notaPosicao", d.notaPosicao),
                    notaCor = o.optString("notaCor", d.notaCor), notaEstilo = o.optString("notaEstilo", d.notaEstilo),
                )
            } catch (_: Exception) { Aparencia() }
        }

        fun save(c: Context, a: Aparencia) = prefs(c).edit().putString("aparencia", a.toJson().toString()).apply()
    }
}
