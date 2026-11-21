# Resumo técnico para o app Android (APK)

Contexto para outro chat: o app do PC (Criador de EPUB, Electron) já salva os EPUBs no Google Drive
de cada usuário. O app Android deve ler os mesmos arquivos.

## Google / Drive
- **Mesmo projeto do Google Cloud** do app do PC. Criar mais um cliente OAuth do tipo **Android**
  (nome do pacote + impressão digital SHA-1 da chave que assina o APK).
- Escopo: **`https://www.googleapis.com/auth/drive.file`** (+ `openid email profile`).
  Com `drive.file`, o acesso é por app/projeto: todos os clientes OAuth do MESMO projeto enxergam os
  arquivos criados pelo app do PC. Um projeto diferente NÃO enxergaria.
- **A partir da versão 1.8.0 do PC há CATEGORIAS** — ver `PROMPT-APK-CATEGORIAS-E-LEITURA.md`
  (categoria = subpasta de `Criador de EPUB`; EPUBs soltos na raiz contam como `Outros`).
- Pasta: **`Criador de EPUB`** na raiz do Meu Drive
  (consulta usada no PC: `name='Criador de EPUB' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`).
  Se não existir, o app cria.
- Arquivos: `mimeType = application/epub+zip`, nome `<Título>.epub`. Listagem usada no PC:
  `'<idDaPasta>' in parents and trashed=false`, `orderBy=modifiedTime desc`, campos `id,name,modifiedTime,size`.
- Download: `GET https://www.googleapis.com/drive/v3/files/<id>?alt=media`.
- O PC substitui o mesmo arquivo (mesmo id) ao salvar de novo → o tablet pode comparar `modifiedTime`
  para saber se precisa baixar de novo.

## Estrutura do EPUB gerado (EPUB 3, com toc.ncx para compatibilidade)
- `mimetype`, `META-INF/container.xml` → `OEBPS/content.opf`
- `OEBPS/capa.xhtml` (opcional, capa em SVG), `OEBPS/texto.xhtml` (todo o conteúdo), `OEBPS/nav.xhtml`,
  `OEBPS/toc.ncx`, `OEBPS/style.css`, `OEBPS/images/…`
- Metadado extra: `<meta name="criador-epub:notas-titulo" content="Notas"/>`

## Anotações (importante para o leitor do tablet)
No texto:
```html
<a href="#fn3" id="r3" class="noteref" epub:type="noteref">Oseias 13:14</a>
```
No final de `texto.xhtml`:
```html
<div class="footnotes" epub:type="endnotes">
  <h3>Notas</h3>
  <p id="fn3" class="nota" epub:type="endnote">Oseias 13:14 (Tradução do Novo Mundo): "14 …<br />…" <a href="#r3">↩</a></p>
</div>
```
- As quebras de linha das notas (parágrafos/poesia) são `<br />`.
- Sugestão para o tablet: ao tocar em `a.noteref`, mostrar o conteúdo de `#fnN` num balão/popup
  (sem o link ↩), em vez de pular para o fim do livro.
- Imagens: `<img src="images/imagem_001.png" style="width: 50%; height: auto;">` (largura em % da página).
- Quebra de página: `<div class="pagebreak"></div>`.
