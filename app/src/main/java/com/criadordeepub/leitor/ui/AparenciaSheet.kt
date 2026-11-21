package com.criadordeepub.leitor.ui

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.InputFilter
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.criadordeepub.leitor.Aparencia
import com.criadordeepub.leitor.R
import com.criadordeepub.leitor.Tema
import com.criadordeepub.leitor.Temas
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.ChipGroup
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.slider.Slider

/**
 * Painel "Aa": muda a aparência ao vivo (o próprio texto do discurso, visível acima do painel,
 * serve de pré-visualização). Cada mudança é salva e enviada para [onChange].
 */
class AparenciaSheet(
    private val activity: AppCompatActivity,
    private var ap: Aparencia,
    private val emApresentacao: Boolean,
    private val onChange: (Aparencia) -> Unit,
    private val onApresentacao: () -> Unit,
) {
    private val dialog = BottomSheetDialog(activity)
    private val root: View = LayoutInflater.from(activity).inflate(R.layout.sheet_aparencia, null)
    private val dp = activity.resources.displayMetrics.density
    private var binding = false // evita reagir enquanto os controles são preenchidos

    private val paragrafos = mapOf(R.id.pOriginal to "original", R.id.pNenhum to "0", R.id.pPequeno to "0.5", R.id.pMedio to "1", R.id.pGrande to "1.6")
    private val recuos = mapOf(R.id.rOriginal to "original", R.id.rNenhum to "0", R.id.rPequeno to "1.5", R.id.rGrande to "3")
    private val alinhamentos = mapOf(R.id.aOriginal to "original", R.id.aJustificado to "justificado", R.id.aEsquerda to "esquerda")
    private val notaCores = mapOf(R.id.ncTema to "tema", R.id.ncVermelho to "vermelho", R.id.ncAzul to "azul",
        R.id.ncVerde to "verde", R.id.ncRoxo to "roxo", R.id.ncLaranja to "laranja")
    private val notaEstilos = mapOf(R.id.neTracejado to "pontilhado", R.id.neSublinhado to "sublinhado", R.id.neFundo to "fundo", R.id.neNegrito to "negrito")
    private val notas = mapOf(R.id.nCentro to "centro", R.id.nBaixo to "baixo", R.id.nMovel to "movel")
    private val fontes = mapOf(R.id.fOriginal to "original", R.id.fSerif to "serifada", R.id.fSans to "sem-serifa", R.id.fFacil to "leitura-facil", R.id.fMono to "mono")

    fun show() {
        dialog.setContentView(root)
        dialog.window?.setDimAmount(0f) // não escurece o texto: ele é a pré-visualização
        dialog.behavior.apply {
            maxHeight = (activity.resources.displayMetrics.heightPixels * 0.55).toInt()
            state = BottomSheetBehavior.STATE_EXPANDED
            skipCollapsed = true
        }
        wire()
        bind()
        dialog.show()
    }

    private fun update(change: (Aparencia) -> Aparencia) {
        if (binding) return
        ap = change(ap)
        Aparencia.save(activity, ap)
        onChange(ap)
    }

    // ---------------- ligação dos controles ----------------

    private fun wire() {
        root.findViewById<MaterialButton>(R.id.btnRestaurar).setOnClickListener {
            ap = Aparencia()
            Aparencia.save(activity, ap)
            onChange(ap)
            bind()
        }
        root.findViewById<MaterialButton>(R.id.btnApresentacao).apply {
            text = if (emApresentacao) "Sair do modo apresentação" else "Modo apresentação (letra grande, tela cheia, cronômetro)"
            setOnClickListener { dialog.dismiss(); onApresentacao() }
        }
        root.findViewById<MaterialButton>(R.id.btnCor).setOnClickListener { escolherCores() }
        root.findViewById<MaterialSwitch>(R.id.swSistema).setOnCheckedChangeListener { _, v -> update { it.copy(seguirSistema = v) }; marcarTema() }
        root.findViewById<MaterialSwitch>(R.id.swTelaLigada).setOnCheckedChangeListener { _, v -> update { it.copy(telaLigada = v) } }

        slider(R.id.slTamanho) { v ->
            update { if (emApresentacao) it.copy(tamanhoApresentacao = v) else it.copy(tamanho = v) }
            valores()
        }
        slider(R.id.slMargemLat) { v -> update { it.copy(margemLateral = v) }; valores() }
        slider(R.id.slMargemVert) { v -> update { it.copy(margemVertical = v) }; valores() }
        slider(R.id.slLinhas) { v -> update { it.copy(linhas = v) }; valores() }
        slider(R.id.slLetras) { v -> update { it.copy(letras = v) }; valores() }
        slider(R.id.slBrilho) { v -> update { it.copy(brilho = v / 100f) }; valores() }
        root.findViewById<CheckBox>(R.id.cbBrilhoAuto).setOnCheckedChangeListener { _, auto ->
            root.findViewById<Slider>(R.id.slBrilho).isEnabled = !auto
            update { it.copy(brilho = if (auto) -1f else root.findViewById<Slider>(R.id.slBrilho).value / 100f) }
            valores()
        }

        chips(R.id.cgFonte, fontes) { v -> update { it.copy(fonte = v) } }
        chips(R.id.cgParagrafo, paragrafos) { v -> update { it.copy(paragrafo = v) } }
        chips(R.id.cgRecuo, recuos) { v -> update { it.copy(recuo = v) } }
        chips(R.id.cgAlinhamento, alinhamentos) { v -> update { it.copy(alinhamento = v) } }
        chips(R.id.cgNota, notas) { v -> update { it.copy(notaPosicao = v) } }
        chips(R.id.cgNotaCor, notaCores) { v -> update { it.copy(notaCor = v) } }
        chips(R.id.cgNotaEstilo, notaEstilos) { v -> update { it.copy(notaEstilo = v) } }

        montarTemas()
    }

    private fun slider(id: Int, onValue: (Int) -> Unit) {
        root.findViewById<Slider>(id).addOnChangeListener { _, value, fromUser -> if (fromUser) onValue(value.toInt()) }
    }

    private fun chips(id: Int, map: Map<Int, String>, onValue: (String) -> Unit) {
        root.findViewById<ChipGroup>(id).setOnCheckedStateChangeListener { _, ids ->
            ids.firstOrNull()?.let { map[it] }?.let(onValue)
        }
    }

    /** Preenche os controles com os valores atuais. */
    private fun bind() {
        binding = true
        fun setSlider(id: Int, v: Int) {
            val s = root.findViewById<Slider>(id)
            s.value = v.toFloat().coerceIn(s.valueFrom, s.valueTo)
        }
        setSlider(R.id.slTamanho, if (emApresentacao) ap.tamanhoApresentacao else ap.tamanho)
        setSlider(R.id.slMargemLat, ap.margemLateral)
        setSlider(R.id.slMargemVert, ap.margemVertical)
        setSlider(R.id.slLinhas, ap.linhas)
        setSlider(R.id.slLetras, ap.letras)
        val auto = ap.brilho < 0
        setSlider(R.id.slBrilho, if (auto) 60 else (ap.brilho * 100).toInt())
        root.findViewById<Slider>(R.id.slBrilho).isEnabled = !auto
        root.findViewById<CheckBox>(R.id.cbBrilhoAuto).isChecked = auto
        root.findViewById<MaterialSwitch>(R.id.swSistema).isChecked = ap.seguirSistema
        root.findViewById<MaterialSwitch>(R.id.swTelaLigada).isChecked = ap.telaLigada
        fun check(group: Int, map: Map<Int, String>, value: String) {
            val id = map.entries.firstOrNull { it.value == value }?.key ?: map.keys.first()
            root.findViewById<ChipGroup>(group).check(id)
        }
        check(R.id.cgFonte, fontes, ap.fonte)
        check(R.id.cgParagrafo, paragrafos, ap.paragrafo)
        check(R.id.cgRecuo, recuos, ap.recuo)
        check(R.id.cgAlinhamento, alinhamentos, ap.alinhamento)
        check(R.id.cgNota, notas, ap.notaPosicao)
        check(R.id.cgNotaCor, notaCores, ap.notaCor)
        check(R.id.cgNotaEstilo, notaEstilos, ap.notaEstilo)
        binding = false
        valores()
        marcarTema()
    }

    private fun valores() {
        fun tv(id: Int) = root.findViewById<TextView>(id)
        tv(R.id.tvTamanho).text = "${if (emApresentacao) ap.tamanhoApresentacao else ap.tamanho}%" + if (emApresentacao) " (apresentação)" else ""
        tv(R.id.tvMargemLat).text = "${ap.margemLateral}%"
        tv(R.id.tvMargemVert).text = "${ap.margemVertical}%"
        tv(R.id.tvLinhas).text = String.format("%.1f", ap.linhas / 10.0)
        tv(R.id.tvLetras).text = String.format("%.2f", ap.letras / 100.0)
        tv(R.id.tvBrilho).text = if (ap.brilho < 0) "Automático" else "${(ap.brilho * 100).toInt()}%"
    }

    // ---------------- temas ----------------

    private val swatches = mutableMapOf<String, View>()

    private fun montarTemas() {
        val box = root.findViewById<LinearLayout>(R.id.temasBox)
        box.removeAllViews()
        swatches.clear()
        val temas = Temas.all(activity)
        for (grupo in Temas.GRUPOS) {
            val lista = temas.filter { it.grupo == grupo }
            if (lista.isEmpty()) continue
            box.addView(TextView(activity).apply {
                text = grupo
                setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_LabelMedium)
                setPadding(0, (8 * dp).toInt(), 0, (4 * dp).toInt())
            })
            val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            lista.forEach { row.addView(swatch(it)) }
            box.addView(HorizontalScrollView(activity).apply { isHorizontalScrollBarEnabled = false; addView(row) })
        }
        // outros grupos que alguém acrescentar no temas.json
        val extras = temas.filter { it.grupo !in Temas.GRUPOS }
        if (extras.isNotEmpty()) {
            val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            extras.forEach { row.addView(swatch(it)) }
            box.addView(HorizontalScrollView(activity).apply { addView(row) })
        }
    }

    @SuppressLint("SetTextI18n")
    private fun swatch(t: Tema): View {
        val w = (78 * dp).toInt()
        val cell = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding((4 * dp).toInt(), 0, (4 * dp).toInt(), 0)
        }
        val frame = FrameLayout(activity).apply {
            layoutParams = LinearLayout.LayoutParams(w, (54 * dp).toInt())
            background = GradientDrawable().apply {
                cornerRadius = 14 * dp
                setColor(t.fundo)
                setStroke((1 * dp).toInt(), Color.argb(70, 0, 0, 0))
            }
        }
        frame.addView(TextView(activity).apply {
            text = if (t.json.has("textura")) "Aa ≋" else "Aa"
            setTextColor(t.texto)
            textSize = 18f
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        })
        cell.addView(frame)
        cell.addView(TextView(activity).apply {
            text = t.nome
            textSize = 12f
            gravity = Gravity.CENTER
            maxWidth = w
        })
        cell.setOnClickListener {
            update { it.comTema(t) }
            marcarTema()
        }
        swatches[t.id] = frame
        return cell
    }

    private fun marcarTema() {
        val ativo = ap.temaAtivo(activity).id
        val sel = ContextCompat.getDrawable(activity, R.drawable.bg_swatch_sel)
        swatches.forEach { (id, v) -> v.foreground = if (id == ativo) sel else null }
    }

    // ---------------- cor personalizada ----------------

    private val coresFundo = listOf(
        "#FFFFFF", "#FFF8E7", "#FDF1D6", "#F4ECD8", "#EFE6D2", "#E8E8E8", "#E3EFE0", "#E4EDF6", "#F6E4E4", "#EDE4F6",
        "#FFF3B0", "#D8E8D0", "#000000", "#121212", "#1E1E1E", "#202326", "#2A2218", "#10202E", "#1B2A1B", "#2B1D2B",
    )
    private val coresTexto = listOf(
        "#000000", "#1B1B1B", "#333333", "#3A2E1F", "#1A2533", "#1D2A1C", "#4A1010", "#2A1A40",
        "#FFFFFF", "#E6E3DE", "#D9D6D0", "#E8D9BC", "#C9E1FF", "#D6F5D6", "#FFE8A3", "#F2C6C6",
    )

    private fun escolherCores() {
        var fundo = ap.corFundo
        var texto = ap.corTexto
        val pad = (20 * dp).toInt()
        val box = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad / 2, pad, 0) }
        val preview = TextView(activity).apply {
            text = "Exemplo do texto do discurso"
            textSize = 18f
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
        }
        val hexFundo = hexField(); val hexTexto = hexField()
        fun refresh() {
            preview.background = GradientDrawable().apply { cornerRadius = 12 * dp; setColor(fundo); setStroke(1, Color.GRAY) }
            preview.setTextColor(texto)
            if (!hexFundo.hasFocus()) hexFundo.setText(Temas.hex(fundo))
            if (!hexTexto.hasFocus()) hexTexto.setText(Temas.hex(texto))
        }
        box.addView(preview)
        box.addView(rotulo("Cor do fundo"))
        box.addView(paleta(coresFundo) { fundo = it; hexFundo.clearFocus(); refresh() })
        box.addView(hexFundo)
        box.addView(rotulo("Cor do texto"))
        box.addView(paleta(coresTexto) { texto = it; hexTexto.clearFocus(); refresh() })
        box.addView(hexTexto)
        hexFundo.setOnFocusChangeListener { _, f -> if (!f) { fundo = Temas.parse(hexFundo.text.toString(), fundo); refresh() } }
        hexTexto.setOnFocusChangeListener { _, f -> if (!f) { texto = Temas.parse(hexTexto.text.toString(), texto); refresh() } }
        refresh()
        AlertDialog.Builder(activity)
            .setTitle("Cor personalizada")
            .setView(android.widget.ScrollView(activity).apply { addView(box) })
            .setPositiveButton("Usar") { _, _ ->
                fundo = Temas.parse(hexFundo.text.toString(), fundo)
                texto = Temas.parse(hexTexto.text.toString(), texto)
                update { it.copy(corFundo = fundo, corTexto = texto).comTema(Temas.personalizado(fundo, texto)) }
                marcarTema()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun rotulo(s: String) = TextView(activity).apply {
        text = s
        setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_TitleSmall)
        setPadding(0, (14 * dp).toInt(), 0, (6 * dp).toInt())
    }

    private fun hexField() = EditText(activity).apply {
        hint = "#RRGGBB (código da cor)"
        isSingleLine = true
        filters = arrayOf(InputFilter.LengthFilter(7))
    }

    private fun paleta(cores: List<String>, onPick: (Int) -> Unit): View {
        val grid = GridLayout(activity).apply { columnCount = 10 }
        val s = (30 * dp).toInt()
        val m = (3 * dp).toInt()
        cores.forEach { hex ->
            val c = Color.parseColor(hex)
            grid.addView(View(activity).apply {
                layoutParams = GridLayout.LayoutParams().apply { width = s; height = s; setMargins(m, m, m, m) }
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(c); setStroke((1 * dp).toInt(), Color.GRAY) }
                contentDescription = hex
                setOnClickListener { onPick(c) }
            })
        }
        return grid
    }
}
