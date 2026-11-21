# Criador de EPUB — notas para continuar o desenvolvimento

App Windows (Electron) para escrever discursos/livros e salvar em EPUB. Usuário escreve em português (BR);
responda em português. Código em `app/`. Este repositório é **público**: as versões saem em Releases e o
app se atualiza sozinho por elas.

## Estrutura (`app/`)
- `main.js` — processo principal: janelas, IPC, menu do botão direito nativo (com sugestões do corretor),
  conta Google, biblioteca, atualizador, busca de versículos (`net.fetch`, evita CORS).
- `preload.js` — ponte `window.api` para a página.
- `google.js` — login OAuth (loopback + PKCE, escopo `drive.file`) e Drive: pasta `Criador de EPUB`,
  **categorias = subpastas** (padrão: Discursos Públicos, Tesouros da Palavra de Deus, Outros).
- `local-library.js` — mesma biblioteca no PC: `Documentos\Criador de EPUB\<categoria>\<título>.epub`.
- `updater.js` — lê `releases/latest` do GitHub, baixa o instalador, confere `.sha256`, roda `/S /UPDATE`.
- `google-oauth.json` — cliente OAuth "App para computador" do projeto Google Cloud `criador-de-epub`.
  Vai DENTRO do app, mas **não está no Git** (o GitHub bloqueia segredos). Numa sessão nova, peça ao
  usuário o arquivo `client_secret_595469431760-….json` e salve como `app/google-oauth.json` ANTES de publicar
  — sem ele, a versão sai sem o login do Google configurado.
- `src/` — interface: `renderer.js` (TinyMCE, anotações, biblioteca, janela Salvar, conta, atualizações),
  `epub.js` (exporta/importa EPUB; anotações viram notas no fim com ↩), `bible.js` (referências →
  jw.org JSON `biblia-de-estudo/livros/json/data/BBCCCVVV-BBCCCVVV`), `ref-view.js` (painel "Base para
  comparação": .docx via mammoth, PDF, EPUB, TXT).
- `build/` — ícone e `installer.nsi` (NSIS, instala por usuário, modo `/UPDATE` espera o app fechar e reabre).
- `scripts/publicar.sh` + `scripts/publicar.yml` — publicação. `notas/<versão>.md` — notas de cada versão.
- `tests/` — testes em Node: `node tests/libtest.js`, `node tests/utest.js`, `node tests/gtest.js`.

## Regras já combinadas com o usuário
- Anotação: selecionar texto → botão direito → "Adicionar anotação". No EPUB: `<a class="noteref"
  epub:type="noteref" href="#fnN" id="rN">` e notas no fim em `div.footnotes > p.nota#fnN` com `↩`.
- Nota bíblica: **só o texto** dos versículos (com números e quebras de linha do jw.org, sem `*` e `+`)
  e, na última linha, `Tradução do Novo Mundo`. Sem repetir a referência.
- Abreviações curtas ("Os", "De"…) só valem no modo "loose" (painel de base / seleção), não ao digitar.
- Ao abrir o app: biblioteca. Ao salvar pela 1ª vez: pede título + categoria (+ Drive ou PC).
- `.jwpub` não é suportado (criptografado) — não implementar.
- Assinatura de código e área de IA: o usuário cancelou.
- App Android (tablet) é feito em OUTRO chat; os prompts para ele estão em `app/PROMPT-APK-*.md`
  e `app/RESUMO-PARA-APK.md`. Mudou a estrutura do Drive ou do EPUB? Gere um prompt novo para ele.

## Ambiente (sessão nova)
```bash
cd app && npm ci
apt-get install -y nsis
# e coloque app/google-oauth.json (pedir ao usuário)
```

## Publicar uma versão nova
1. Escreva `app/notas/X.Y.Z.md` (o que mudou, em português).
2. `cd app && ./scripts/publicar.sh X.Y.Z notas/X.Y.Z.md` (5–8 min; roda melhor em segundo plano).
   Ele ajusta a versão no `package.json`, gera o app (electron-packager), o instalador (makensis),
   divide em partes de 45 MB e envia ao ramo temporário `publicar`; a Action do repositório junta,
   confere o SHA-256, cria o Release e apaga o ramo.
3. Depois, faça commit das mudanças de `app/` (inclui o `package.json` com a versão nova).

Cuidados: esta sessão **não** pode criar Releases pela API nem usar GraphQL (`gh release …` falha);
use `gh api repos/guigon96-glitch/EpubJWAssistent/...` (REST). A Action precisa estar no próprio
ramo `publicar` (o script já copia `scripts/publicar.yml`).

## Histórico de versões
1.0–1.6 (sem atualizador) · 1.7.0 atualizador · 1.8.0 biblioteca + categorias ·
1.8.1 login Google embutido + novo formato da nota bíblica.
