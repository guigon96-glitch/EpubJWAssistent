#!/usr/bin/env bash
# Gera o instalador e publica uma nova versão no GitHub Releases.
# Uso: scripts/publicar.sh 1.7.0 notas/1.7.0.md
set -euo pipefail
VERSAO="$1"; NOTAS="$2"
REPO="guigon96-glitch/EpubJWAssistent"
cd "$(dirname "$0")/.."
[[ "$VERSAO" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "versão inválida: $VERSAO"; exit 1; }
[ -f "$NOTAS" ] || { echo "arquivo de notas não encontrado: $NOTAS"; exit 1; }
[ -f google-oauth.json ] || { echo "falta google-oauth.json (peça ao usuário) — sem ele o login do Google não funciona"; exit 1; }
if gh api "repos/$REPO/releases/tags/v$VERSAO" >/dev/null 2>&1; then echo "a versão v$VERSAO já existe no GitHub"; exit 1; fi

node -e "const f='package.json',p=require('./'+f);p.version='$VERSAO';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
npx electron-packager . "Criador de EPUB" --platform=win32 --arch=x64 --out=dist --overwrite --asar \
  --ignore='^/dist' --ignore='^/build' --ignore='^/scripts' --ignore='^/notas' --ignore='^/tests' \
  --app-version="$VERSAO" --icon=build/icon.ico \
  --win32metadata.CompanyName="Criador de EPUB" --win32metadata.FileDescription="Criador de EPUB" --win32metadata.ProductName="Criador de EPUB"
cp LEIA-ME.txt GUIA-GOOGLE.txt "dist/Criador de EPUB-win32-x64/"
# só os idiomas usados (deixa o instalador bem menor)
find "dist/Criador de EPUB-win32-x64/locales" -name '*.pak' ! -name 'en-US.pak' ! -name 'pt-BR.pak' ! -name 'pt-PT.pak' -delete
(cd build && makensis -V2 -DVERSION="$VERSAO" installer.nsi)
INST="Instalar-Criador-de-EPUB-$VERSAO.exe"
(cd dist && sha256sum "$INST" > "$INST.sha256")
# envia para o ramo temporário "publicar"; a GitHub Action do repositório cria a versão
TMP="$(mktemp -d)"
mkdir -p "$TMP/partes"
cp "dist/$INST.sha256" "$TMP/"
cp "$NOTAS" "$TMP/notas.md"
echo "$VERSAO" > "$TMP/versao.txt"
# o GitHub lê a Action do próprio ramo enviado
mkdir -p "$TMP/.github/workflows" && cp scripts/publicar.yml "$TMP/.github/workflows/publicar.yml"
(cd "$TMP/partes" && split -b 45M -d -a 2 "$OLDPWD/dist/$INST" "$INST.part-")
(
  cd "$TMP"
  git init -q && git checkout -q --orphan publicar
  git add -A
  git -c user.name="guigon96-glitch" -c user.email="guigon96-glitch@users.noreply.github.com" commit -q -m "Publicar versão $VERSAO"
  git remote add origin "https://github.com/guigon96-glitch/EpubJWAssistent"
  for i in 1 2 3 4; do git push -f origin publicar && break || sleep $((i*2)); done
)
rm -rf "$TMP"
echo "Enviado. Aguardando a GitHub Action publicar a versão…"
for i in $(seq 1 60); do
  if gh api "repos/$REPO/releases/tags/v$VERSAO" >/dev/null 2>&1; then
    echo "Publicado: https://github.com/$REPO/releases/tag/v$VERSAO"; exit 0
  fi
  sleep 10
done
echo "A versão ainda não apareceu. Veja: https://github.com/$REPO/actions"; exit 1
