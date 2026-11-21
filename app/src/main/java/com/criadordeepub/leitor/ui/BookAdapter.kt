package com.criadordeepub.leitor.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.RecyclerView
import com.criadordeepub.leitor.BookEntry
import com.criadordeepub.leitor.R
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class BookAdapter(
    private val onClick: (BookEntry) -> Unit,
    private val onLongClick: (BookEntry) -> Unit,
) : RecyclerView.Adapter<BookAdapter.VH>() {

    private var items: List<BookEntry> = emptyList()
    private var mostrarCategoria = false
    private val busy = HashSet<String>()

    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val title: TextView = v.findViewById(R.id.title)
        val subtitle: TextView = v.findViewById(R.id.subtitle)
        val progress: ProgressBar = v.findViewById(R.id.progress)
    }

    fun submit(list: List<BookEntry>, mostrarCategoria: Boolean = false) {
        items = list
        this.mostrarCategoria = mostrarCategoria
        notifyDataSetChanged()
    }

    fun setBusy(id: String, on: Boolean) {
        if (on) busy.add(id) else busy.remove(id)
        val i = items.indexOfFirst { it.id == id }
        if (i >= 0) notifyItemChanged(i)
    }

    override fun getItemCount() = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(LayoutInflater.from(parent.context).inflate(R.layout.item_book, parent, false))

    override fun onBindViewHolder(h: VH, position: Int) {
        val b = items[position]
        h.title.text = b.displayName
        val date = formatDate(b.modifiedTime)
        val status = when {
            b.id in busy -> "⬇ Baixando…"
            b.source == "local" -> "Arquivo do tablet"
            !b.isDownloaded -> "☁ Ainda não baixado"
            b.needsUpdate -> "⟳ Há uma versão mais nova no Drive"
            else -> "✓ Disponível offline"
        }
        val partes = mutableListOf<String>()
        if (mostrarCategoria) partes += if (b.source == "local") MainActivity.ABA_TABLET else b.category
        if (date != null && b.source == "drive") partes += "Alterado em $date"
        partes += status
        h.subtitle.text = partes.joinToString(" · ")
        h.progress.visibility = if (b.id in busy) View.VISIBLE else View.GONE
        h.itemView.setOnClickListener { onClick(b) }
        h.itemView.setOnLongClickListener { onLongClick(b); true }
    }

    companion object {
        private val FMT = DateTimeFormatter.ofPattern("dd/MM/yyyy 'às' HH:mm")
        fun formatDate(iso: String): String? = runCatching {
            Instant.parse(iso).atZone(ZoneId.systemDefault()).format(FMT)
        }.getOrNull()
    }
}

object Insets {
    /** Mantém o conteúdo fora das barras do sistema (Android 15+ desenha de borda a borda). */
    fun applySystemBars(view: View) {
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }
}
