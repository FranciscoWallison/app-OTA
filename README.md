# app-OTA

Aplicativo mobile de demonstracao do sistema de atualizacao **Over-The-Air (OTA)** construido com **Angular 20 + Ionic 8 + Capacitor 8**.

O app se conecta ao servidor [server-OTA](https://github.com/FranciscoWallison/server-OTA) hospedado na Vercel para receber atualizacoes de interface **sem reinstalar o APK**.

---

## Visao Geral da Arquitetura

O ciclo completo envolve dois repositorios GitHub e a Vercel:

1. **Desenvolvedor** faz push para `app-OTA`
2. **GitHub Actions** compila o Angular e publica o bundle no `server-OTA`
3. **Vercel** detecta o push no `server-OTA` e faz deploy automatico
4. **App no celular** consulta a API, baixa o bundle e aplica sem reinstalar

<img width="7736" height="8192" alt="App Version Update Pipeline-2026-03-03-131755" src="https://github.com/user-attachments/assets/092eee20-c015-424d-b935-09c861716569" />


---

## APK Build vs Bundle OTA

| | APK Build | Bundle OTA |
|---|---|---|
| O que e | App completo instalado no celular | Somente o www/ (HTML/JS/CSS) compactado |
| Como atualiza | Usuario desinstala e reinstala | App baixa automaticamente em background |
| Pode mudar telas/temas | Sim | Sim |
| Pode mudar logica Angular | Sim | Sim |
| Pode adicionar plugin nativo | Sim | Nao |
| Pode mudar permissoes Android | Sim | Nao |
| Gerado por | build-apk.yml | deploy-ota.yml |
| Versao no app | APK Build (ex: v1.1.0) | Bundle OTA (ex: v1.0.0, muda apos update) |

> **Regra pratica:** mudou so codigo Angular? OTA resolve. Mudou plugin nativo ou permissao? Precisa novo APK.

---

## Fluxo de Atualizacao OTA

```
App abre
   |
   v
OtaManagerService.initialize()
   |
   +- GET /api/version  (header: X-Current-Version: 1.0.0)
   |     Resposta: { version: "1.2.0", sha256: "abc...", hmac: "..." }
   |
   +- Valida HMAC (confirma que veio do servidor legitimo)
   |
   +- GET /api/bundle/1.2.0  -> baixa bundle-1.2.0.zip
   |
   +- Verifica sha256 do arquivo baixado
   |
   +- Extrai zip em: /data/app/.../files/bundles/1.2.0/
   |
   +- Salva caminho no SharedPreferences (Capacitor le na proxima abertura)

Usuario reinicia o app
   +- WebView carrega de: /files/bundles/1.2.0/  <- nova versao ativa
```

---

## Comunicacao com server-OTA

### GET /api/version

Verifica se ha versao mais recente disponivel.

**Header enviado pelo app:**
```
X-Current-Version: 1.0.0
```

**Resposta:**
```json
{
  "version": "1.2.0",
  "sha256": "e9e25db1...",
  "hmac": "sha256=abc123...",
  "minVersion": "1.0.0",
  "forceUpdate": false,
  "size": 524288,
  "timestamp": "2026-03-03T10:00:00.000Z"
}
```

### GET /api/bundle/:version

Baixa o bundle zip da versao solicitada. Faz redirect para o arquivo estatico
em `/bundles/bundle-{version}.zip`.

### GET /api/health

Healthcheck do servidor.

### POST /api/report

App reporta o resultado da atualizacao (sucesso ou falha).

---

### manifest.json

Arquivo central que lista todas as versoes disponiveis no servidor:

```json
{
  "currentVersion": "1.2.0",
  "minVersion": "1.0.0",
  "versions": [
    {
      "version": "1.2.0",
      "sha256": "e9e25db1e40e9a393a5432f7d031fa4b...",
      "size": 6832128,
      "createdAt": "2026-03-03T10:41:00.000Z"
    }
  ]
}
```

- **currentVersion** — versao que o app deve ter
- **minVersion** — versao minima (abaixo disso o app e forcado a atualizar)

---

## Seguranca: HMAC

Cada resposta do `/api/version` inclui um **HMAC** (Hash-based Message Authentication Code).

O app valida o HMAC antes de baixar qualquer bundle, garantindo que a resposta
veio do servidor legitimo e nao foi adulterada.

```
Payload assinado: "{version}:{sha256}:{minVersion}:{timestamp}"
Algoritmo:        HMAC-SHA256
Chave:            variavel de ambiente HMAC_SECRET (servidor Vercel)
```

---

## CI/CD: GitHub Actions

### deploy-ota.yml — Publica Bundle OTA

Acionado em todo `push` para `main`.

```
push -> main
   +- npm install
   +- ng build --configuration production
   +- remove source maps
   +- zip www/ -> bundle-{version}.zip
   +- sha256 do zip
   +- checkout server-OTA (via DEPLOY_TOKEN secret)
   +- copia bundle para server-ota/public/bundles/
   +- atualiza manifest.json (versao + sha256 + tamanho)
   +- git push -> server-OTA -> Vercel deploy automatico
```

**Secret necessario:** `DEPLOY_TOKEN` — Classic PAT do GitHub com escopo `repo`.

### build-apk.yml — Gera APK Android

Acionado em todo `push` para `main` e manualmente via `workflow_dispatch`.

```
push -> main
   +- setup Java 21 (Temurin) + Android SDK
   +- npm install
   +- injeta versao do package.json em environment.prod.ts
   +- ng build --configuration production
   +- cap add android
   +- cria OtaBundlePlugin.java (plugin nativo OTA)
   +- adiciona permissoes no AndroidManifest.xml
   +- registra plugin no MainActivity.java
   +- cap sync
   +- gradle assembleDebug
   +- upload artifact: app-ota-v{version}-debug
```

---

## Versoes

O app exibe duas versoes independentes:

| Campo | Fonte | Significado |
|---|---|---|
| **APK Build** | package.json injetado no CI em environment.prod.ts | Versao do APK instalado |
| **Bundle OTA** | OtaManagerService.state.currentVersion | Bundle ativo no momento |

**Instalacao limpa:**
- APK Build -> v1.2.0
- Bundle OTA -> v1.0.0 (baseline, ainda nao recebeu OTA)

**Apos receber e aplicar OTA:**
- APK Build -> v1.2.0 (nao muda, e o APK)
- Bundle OTA -> v1.2.0 (atualizado)

Para publicar nova versao: altere o campo `"version"` no `package.json` e faca `git push`.

---

## Sistema de Temas

Os temas sao definidos em `src/app/services/theme.service.ts` no array `APP_THEMES`.
Cada tema define as variaveis CSS do Ionic (primary, secondary, tertiary).

Temas atuais:

| ID | Nome | Cor principal |
|---|---|---|
| blue | Azul Padrao | #3880ff |
| green | Verde Natureza | #2dd36f |
| purple | Roxo Moderno | #7c3aed |
| red | Vermelho Fogo | #e63946 |

- A escolha do usuario e salva no dispositivo via `Capacitor Preferences`
- **Adicionar/remover temas** nao requer novo APK — basta publicar via OTA
- **Forcar novo tema padrao para todos os usuarios:** trocar o valor de `THEME_KEY`
  (ex: de `app-theme` para `app-theme-v2`) — zera a preferencia salva e todos
  recebem o novo padrao na proxima abertura do app

---

## Estrutura do Projeto

```
app-OTA/
+-- .github/workflows/
|   +-- deploy-ota.yml          # publica bundle OTA no server-OTA
|   +-- build-apk.yml           # gera APK Android
+-- src/
|   +-- app/
|   |   +-- home/               # tela principal
|   |   +-- services/
|   |       +-- ota-manager.service.ts   # logica de atualizacao OTA
|   |       +-- theme.service.ts         # gerenciamento de temas
|   +-- environments/
|       +-- environment.ts               # dev (localhost:3000)
|       +-- environment.prod.ts          # prod (server-ota.vercel.app)
+-- android/                    # gerado pelo CI (nao versionado)
+-- www/                        # output do ng build
+-- package.json                # versao do app
```

---

## Repositorios Relacionados

| Repositorio | Funcao |
|---|---|
| [app-OTA](https://github.com/FranciscoWallison/app-OTA) | App mobile (este repo) |
| [server-OTA](https://github.com/FranciscoWallison/server-OTA) | Backend Next.js + armazenamento dos bundles |

**Servidor em producao:** https://server-ota.vercel.app
