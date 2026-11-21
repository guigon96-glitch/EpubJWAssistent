# Leitor de Discursos (app Android do tablet) — contexto para continuar o trabalho

> Leia isto primeiro numa conversa nova. O dono do projeto **não é programador**: responda em
> português do Brasil, de forma simples. Ele usa o app no púlpito (discursos), num tablet Android.

## O que é
App Android (APK instalado à mão, sem Play Store) que mostra os EPUBs salvos no Google Drive pelo
programa de PC **Criador de EPUB** (Electron/Windows, publicado neste mesmo repositório: tags `vX.Y.Z`).
Várias pessoas usam, cada uma com a própria conta Google e os próprios arquivos.

- Pacote: `com.criadordeepub.leitor` · versão atual no código: ver `app/build.gradle.kts` (`versionName`).
- Stack: Kotlin nativo + WebView (o XHTML do EPUB é montado numa página única de rolagem contínua).
- Assinatura: keystore `leitor-discursos.jks` (alias `leitor`). **NÃO está no git** (repositório público).
  O usuário guarda o `.jks` e o `SENHAS-DA-CHAVE.txt`; peça os dois para gerar uma versão nova.
  Coloque-os em `assinatura/leitor-discursos.jks` e crie `assinatura/keystore.properties`:
  ```
  storeFile=assinatura/leitor-discursos.jks
  storePassword=<senha>
  keyAlias=leitor
  keyPassword=<senha>
  ```
  SHA-1 do certificado: `24:AC:79:99:7C:14:C1:2B:22:57:6C:90:45:D7:15:DE:03:68:75:9F`
  (cadastrado no cliente OAuth tipo **Android** do projeto do Google Cloud). Sem essa chave, o APK
  novo não instala por cima e o login com Google para de funcionar.

## Google (login e Drive)
- Login: `Identity.getAuthorizationClient` (play-services-auth) com escopos
  `drive.file` + `openid email profile`; e-mail lido em `oauth2/v3/userinfo`. Sair:
  `CredentialManager.clearCredentialState` + `clearToken`. (Não usa cliente Web.)
- **Somente `drive.file`** — nunca ampliar. Funciona porque o cliente Android está no MESMO projeto do
  Cloud que o cliente "App para computador" do PC (o "app" do drive.file é o projeto).
- Pasta raiz `Criador de EPUB` (na raiz do Meu Drive). **Categorias = subpastas**. Padrão, nesta ordem:
  `Discursos Públicos`, `Tesouros da Palavra de Deus`, `Outros`; depois as demais em ordem alfabética.
  EPUBs soltos na raiz → `Outros`. Arquivos identificados pelo `id` (podem ser renomeados/movidos);
  `modifiedTime` decide se baixa de novo. Regras puras em `drive/Categorias.kt` (com testes).
- O tablet só lê; o único "escrever" é "Nova categoria" (cria subpasta).

## Estrutura do código (app/src/main/java/com/criadordeepub/leitor/)
- `epub/Epub.kt` — extrai o EPUB (anti zip-slip), lê OPF/nav/NCX, esconde a capa, monta a página
  única (`ReaderHtmlBuilder`: ids com prefixo `s<n>_`, links reescritos, scripts removidos) e injeta
  `window.LEITOR_APARENCIA` e `window.LEITOR_MARCAS`.
- `drive/DriveClient.kt` (REST v3 com HttpURLConnection), `drive/Categorias.kt`.
- `Library.kt` — arquivos por conta (`filesDir/contas/<sha1(email)>/`): EPUBs, extraídos,
  `biblioteca.json`, `categorias.json`, `marcas/<id>.json`.
- `Auth.kt` (login + `Prefs`), `Aparencia.kt` (preferências do painel Aa + temas).
- `atualizacao/Versoes.kt` (regras puras, com testes) e `Atualizador.kt` (botão "Atualizar app":
  lê `api.github.com/repos/<este repo>/releases`, só tags `android-vX.Y`, baixa o APK, confere o
  `.sha256`, abre o instalador via FileProvider; pede "instalar apps desconhecidos").
- `ui/MainActivity.kt` (abas por categoria, busca, sincronização, atualizar app),
  `ui/ReaderActivity.kt` (leitor: sumário, busca, cronômetro, A−/A+, Aa, marcações, modo apresentação,
  barra com a cor do tema), `ui/AparenciaSheet.kt` (painel Aa), `ui/BookAdapter.kt`.
- `app/src/main/assets/reader/` — `reader.js` (notas em balão: centro/embaixo/móvel e título = texto
  tocado; aparência; texturas SVG; marcações com âncora por citação de texto), `reader.css`,
  `temas.json` (**temas são configuração**: para um tema novo, só acrescentar um bloco),
  `fonts/` (Atkinson Hyperlegible, licença OFL).

## Como compilar (ambiente de nuvem do Claude Code)
1. SDK: baixar `commandlinetools-linux-*_latest.zip` de dl.google.com para `/opt/android-sdk/cmdline-tools/latest`
   e instalar `platform-tools`, `platforms;android-36`, `build-tools;36.0.0`. Criar `local.properties`
   com `sdk.dir=/opt/android-sdk`.
2. `gradle` 8.14.3 já vem em `/opt/gradle-8.14.3` (AGP 8.13.2, Kotlin 2.2.21, JDK 21).
3. `ANDROID_HOME=/opt/android-sdk /opt/gradle-8.14.3/bin/gradle --no-daemon --max-workers=2 :app:testReleaseUnitTest :app:assembleRelease :app:lintRelease`
   (poucos workers: o proxy dá 429 com muitos downloads). APK: `app/build/outputs/apk/release/app-release.apk`.
4. Não há KVM (sem emulador) e o Robolectric não baixa (espelho do Maven bloqueado). As telas nativas
   só são testadas no tablet do usuário.

## Testes
- Unidade (JVM): `app/src/test/...` — EPUB (formato do PC e do Calibre), categorias, versões.
  O teste `write_fixtures_for_browser_test` gera páginas em `app/build/leitor-fixtures/`.
- Navegador (Chromium/Playwright, simula a WebView): em `testes-navegador/`
  `NODE_PATH=$(npm root -g) node teste-leitor.js <pasta-fotos>` (idem `teste-aparencia.js`, `teste-marcacoes.js`).
  Rode depois dos testes de unidade (precisa das fixtures).

## Como publicar uma versão nova (GitHub Releases deste repositório)
A sessão não pode criar releases pela API; usa-se um fluxo do GitHub Actions:
1. Aumente `versionCode`/`versionName` em `app/build.gradle.kts` (e o texto "Leitor de Discursos X.Y" em `strings.xml`).
2. Num clone deste repositório: `git checkout -B publicar-android origin/main`; copie
   `publicacao/publicar-android.yml` para `.github/workflows/`; crie `android/` com
   `Leitor-de-Discursos-X.Y.apk`, `Leitor-de-Discursos-X.Y.apk.sha256` (`sha256sum`),
   `Leitor-de-Discursos-X.Y-codigo-fonte.zip` (opcional), `versao.txt` (`X.Y`) e `notas.md`.
3. Commit e `git push -u origin publicar-android`. O fluxo confere o SHA-256, cria a release
   `android-vX.Y` **com `--latest=false`** (a "mais recente" tem de continuar sendo a do PC, usada pela
   atualização automática do PC) e apaga o ramo. Confira com `gh api repos/<repo>/releases`.
4. O botão "Atualizar app" dos tablets (≥ 1.4) encontra a versão sozinho.

## Histórico
- 1.0 leitor + Drive + notas em balão · 1.1 capa escondida, cronômetro, brilho, busca, % lido
- 1.2 categorias em abas, busca por título, painel Aa (14 temas, texturas, fontes, espaçamentos, modo apresentação)
- 1.3 barra com a cor do tema; balão da nota no centro/embaixo/móvel; título = texto tocado
- 1.4 botão "Atualizar app" (GitHub) + verificação diária
- 1.5 marcações (marca-texto 6 cores, cor da letra, negrito, sublinhado; lista de marcações);
  cor e destaque das anotações no painel Aa

## Ideias ainda não feitas (sugeridas ao usuário)
Régua/faixa de foco de leitura; rolagem automática (teleprompter) com velocidade; notas pessoais
escritas numa marcação; sincronizar marcações entre aparelhos (pelo Drive); exportar marcações;
marcadores de página; ajuste de configurações por discurso; tempo estimado de leitura por seção
usando as marcas "(02:00)" do texto.
