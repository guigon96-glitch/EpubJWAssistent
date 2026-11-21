# Atualização do app Android (tablet): categorias + personalização da leitura

Contexto: o app do PC (Criador de EPUB) vai ganhar **categorias** na versão 1.8.0. O app do tablet precisa
seguir exatamente as mesmas regras do Google Drive para listar e abrir os EPUBs. Além disso, quero mais opções
de personalização na tela de leitura.

---

## 1. Regras do Google Drive (obrigatório seguir igual ao PC)

- Mesmo projeto do Google Cloud do app do PC, escopo `https://www.googleapis.com/auth/drive.file`
  (+ `openid email profile`). Com `drive.file`, o tablet só enxerga o que foi criado por clientes do MESMO projeto.
- **Pasta raiz**: `Criador de EPUB`, na raiz do Meu Drive
  (`name='Criador de EPUB' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`).
- **Categorias = subpastas** da pasta raiz
  (`'<idRaiz>' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`).
  - O nome da subpasta é o nome da categoria.
  - Categorias padrão (criadas pelo PC; o tablet deve criar se não existirem e precisar):
    1. `Discursos Públicos`
    2. `Tesouros da Palavra de Deus`
    3. `Outros`
  - O usuário pode criar outras categorias no PC (e, se quiser, no tablet). Ordem de exibição:
    as 3 padrão primeiro, nessa ordem; depois as demais em ordem alfabética.
- **EPUBs**: arquivos `mimeType = application/epub+zip` (ou nome terminando em `.epub`) dentro de cada subpasta
  (`'<idCategoria>' in parents and trashed=false`), `orderBy=modifiedTime desc`,
  campos `id,name,modifiedTime,size`.
- **Compatibilidade**: EPUBs que estiverem soltos direto na pasta raiz (versões antigas do PC) devem aparecer
  na categoria **Outros**. (O PC 1.8 move esses arquivos para a subpasta `Outros` automaticamente, mas o
  tablet deve tolerar os dois casos.)
- **Nome do arquivo** = título do EPUB + `.epub` (ex.: `Nº 132 Ressurreição.epub`). Mostrar o título sem `.epub`.
  O título "oficial" também está no EPUB em `<dc:title>` do `content.opf`.
- **Metadado extra** no `content.opf`: `<meta name="criador-epub:categoria" content="Discursos Públicos"/>`
  (só informativo — a pasta do Drive é quem manda).
- **Atualizações**: o PC substitui o MESMO arquivo (mesmo `id`) ao salvar de novo e pode **mover** o arquivo de
  categoria (muda o pai) ou **renomear**. O tablet deve:
  - usar o `id` como identificador (não o nome);
  - comparar `modifiedTime` para saber se precisa baixar de novo (cache offline);
  - ao atualizar a lista, refletir mudanças de categoria e de nome.
- Arquivos na lixeira (`trashed=true`) não aparecem.

### Tela inicial do tablet
- Ao abrir: lista de EPUBs **agrupada por categoria** (abas ou seções), com título, data da última alteração
  e indicação se já está baixado (offline).
- Busca por título. Puxar para atualizar.
- Se não houver nenhum EPUB: mensagem amigável ("Nenhum EPUB ainda — crie no app do PC").

## 2. Estrutura do EPUB (sem mudanças em relação ao que já foi passado)
- `OEBPS/texto.xhtml` com todo o conteúdo; `capa.xhtml` opcional; `nav.xhtml` + `toc.ncx`; `style.css`; `images/`.
- Anotações: `<a href="#fnN" id="rN" class="noteref" epub:type="noteref">…</a>` no texto; notas no fim em
  `<div class="footnotes"><p id="fnN" class="nota" epub:type="endnote">texto<br/>… <a href="#rN">↩</a></p></div>`.
  Ao tocar na anotação, mostrar o conteúdo de `#fnN` num balão/popup (sem o ↩), respeitando o tema escolhido.
- Imagens com largura em % (`style="width: 50%"`); quebra de página: `<div class="pagebreak"></div>`.

## 3. Personalização da leitura (NOVO)

Painel de "Aparência" (ícone Aa) na tela de leitura, com pré-visualização ao vivo. Salvar as preferências no
aparelho (e, opcionalmente, por livro). Aplicar por CSS injetado no conteúdo do EPUB (sobrescrevendo cores e
fontes do `style.css` do livro, mas sem quebrar imagens).

### Fundos / temas (não só 3 — deixar aberto e fácil de adicionar novos)
Implementar os temas como uma lista/arquivo de configuração (cor de fundo, cor do texto, cor dos links/anotações,
cor do popup, textura opcional), para eu poder pedir novos depois sem mexer na lógica. Sugestão inicial:
- **Claros**: Branco, Creme, Sépia, Cinza-claro, Verde-suave (descanso visual), Azul-suave
- **Texturas**: **Papiro**, **Pergaminho**, **Papel antigo**, **Papel reciclado**, **Linho**
  - Texturas devem ser **originais/livres de direitos** (geradas por código — ruído/fibras — ou imagens
    próprias leves em WebP, repetidas em mosaico). Garantir contraste do texto (escurecer o texto em texturas).
- **Escuros**: Noite (preto puro, bom para AMOLED), Grafite, Sépia-escuro
- Opção **"Cor personalizada"**: seletor de cor para fundo e texto.
- Opcional: seguir o modo escuro do sistema automaticamente.

### Texto e layout
- **Tamanho da fonte** (controle deslizante, ex.: 80%–220%).
- **Fonte**: Original do livro, Serifada, Sem serifa, uma fonte para leitura fácil (ex.: Atkinson Hyperlegible
  ou outra livre), monoespaçada.
- **Margens** laterais e superior/inferior (deslizante, ex.: 0–15% da largura).
- **Espaçamento entre letras** (`letter-spacing`, ex.: −0,02em a 0,15em).
- **Espaçamento entre linhas** (`line-height`, ex.: 1,2–2,4).
- **Espaçamento entre parágrafos** e **recuo da primeira linha** (opcional).
- **Alinhamento**: original / justificado / à esquerda.
- **Brilho** dentro do app (opcional) e "manter tela ligada" durante a leitura (útil no discurso).
- Botão **"Restaurar padrão"**.
- Guardar a **posição de leitura** por livro (por `id` do Drive).

### Modo apresentação (sugestão para discursos)
- Opção de rolagem contínua (em vez de páginas), fonte grande e tela sempre ligada.
