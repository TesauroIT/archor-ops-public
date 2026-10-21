# Archon Ops

UI interna para gerir ambientes multi-tenant do Dynatrace: enfileira e executa comandos do [Monaco CLI](https://github.com/Dynatrace/dynatrace-configuration-as-code) (`deploy` / `download`) e armazena o versionamento de cada backup num repositório Git local por cliente/ambiente, sem depender de qualquer serviço externo.

Consulte `specs/requirements.md`, `specs/design.md` e `specs/tasks.md` para ver o detalhe funcional e a arquitetura.

## ⚠️ Isenção de Responsabilidade (Disclaimer)

Este software é fornecido **"tal como está" (AS IS)**, sem qualquer garantia de tipo algum, expressa ou implícita. Ao utilizá-lo aceita que:

- As operações de **deploy sobrepõem configurações reais** nos seus ambientes do Dynatrace e podem modificá-las, deixá-las inconsistentes ou danificá-las se não souber o que está a fazer. A app exige uma dupla confirmação antes de qualquer deploy real, mas **a responsabilidade de executar a operação é exclusivamente do operador**.
- Os autores e contribuidores **não assumem qualquer responsabilidade** por perda de configurações, interrupções de monitorização, custos de consumo ou qualquer outro dano direto ou indireto derivado do uso desta ferramenta.
- Antes de um deploy real, execute sempre um **dry-run** e analise o seu log completo. Mantenha backups recentes dos ambientes envolvidos (a app facilita-os, mas verificá-los é responsabilidade do operador).
- Esta ferramenta **não é um produto oficial da Dynatrace** e não está afiliada à Dynatrace LLC. O Monaco CLI e as APIs utilizadas pertencem aos seus respetivos donos; consulte os seus termos de uso.

Utilize-a primeiro contra ambientes de teste e valide o seu fluxo antes de operar em ambientes de produção.

## Requisitos

- Node.js 20.19+ / 22.12+ (recomendado; veja a nota de compatibilidade abaixo)
- Git instalado no servidor/máquina
- O binário do **Dynatrace Monaco CLI (v2)** instalado e acessível no `PATH` (ou configure `MONACO_BIN_PATH` no `.env` apontando para o seu caminho absoluto).

### Instalação do Monaco CLI

#### No Windows (PowerShell):
1. Descarregue o executável a partir da [página de Releases do Dynatrace](https://github.com/dynatrace/dynatrace-configuration-as-code/releases):
   ```powershell
   # Descarregar a versão estável mais recente (exemplo para Windows amd64)
   Invoke-WebRequest -Uri "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-windows-amd64.exe" -OutFile "C:\dynatrace\monaco.exe"
   ```
2. Adicione `C:\dynatrace\` às variáveis de ambiente do seu sistema (`PATH`), ou defina a sua localização exata no seu ficheiro `.env`:
   ```env
   MONACO_BIN_PATH="C:\\dynatrace\\monaco.exe"
   ```

#### No Linux / macOS (Bash):
1. Descarregue e atribua permissões de execução:
   ```bash
   # Descarregar para Linux amd64
   sudo curl -L "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64" -o /usr/local/bin/monaco
   sudo chmod +x /usr/local/bin/monaco
   ```
2. Se preferir guardá-lo num caminho de utilizador, lembre-se de configurar no seu `.env`:
   ```env
   MONACO_BIN_PATH="/home/usuario/bin/monaco"
   ```

> **Nota de Compatibilidade:** O projeto foi inicializado e testado com Node 20.16. Se o seu Node for o 20.16 ou similar, use `prisma@6`/`@prisma/client@6` (que já estão instalados) — as versões 7+ do Prisma exigem Node 20.19+.

## Instalação (Uso local, um utilizador único)

```bash
npm install
cp .env.example .env
# Edite o .env: mude pelo menos ENCRYPTION_KEY e SEED_ADMIN_PASSWORD.
# Gere uma ENCRYPTION_KEY com:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npx prisma migrate dev
npx prisma db seed   # cria o utilizador admin (SEED_ADMIN_EMAIL/PASSWORD)

# Iniciar servidor de desenvolvimento em porta por defeito (3000) ou uma personalizada
PORT=3080 npm run dev
```

Abra http://localhost:3000 (ou a porta que definiu), inicie sessão com as credenciais semeadas e crie o seu primeiro cliente + ambiente.

## Uso em Servidor (Múltiplos clientes e persistência)

1. Altere `datasource.provider` em `prisma/schema.prisma` para `"postgresql"` e ajuste `DATABASE_URL` no `.env` para o seu Postgres.
2. Defina `DATA_DIR` para um caminho persistente do servidor (ex. um disco dedicado) onde serão guardados os repositórios Git de cada cliente/ambiente.
3. Compile a aplicação para produção:
   ```bash
   npm run build
   ```
4. **Executar usando PM2**:
   O projeto inclui um ficheiro `ecosystem.config.js` pronto a ser usado. Pode instalar o PM2 de forma global e iniciar a aplicação facilmente:
   ```bash
   # Instalar PM2 se não tiver
   npm install -g pm2

   # Iniciar a app (por defeito levantará na porta configurada no ecosystem/env)
   pm2 start ecosystem.config.js

   # Se desejar alterar a porta a quente ao iniciar com o PM2:
   PORT=4000 pm2 restart archon-ops --update-env
   ```
   *Nota: O worker de Jobs corre no mesmo processo do Node, não necessita de Redis ou de um serviço externo de filas.*

## Como Funciona

- **Deploy/Backup** são disparados a partir da UI de um Environment e criam um registo `Job` na base de dados (o comando não se executa no mesmo request HTTP).
- Um worker interno (`lib/server/worker.ts`) obtém os Jobs `PENDING`, invoca o `monaco` via `child_process.spawn` injetando o token como variável de ambiente, e transmite o log em tempo real para a UI via Server-Sent Events (`/api/jobs/:id/stream`).
- Ao terminar um Backup (ou um Deploy) com sucesso, é feito um commit automático no repositório Git local desse Environment (`DATA_DIR/<cliente>/<ambiente>`) — sem remoto configurado, servindo apenas de histórico local.
- Os tokens do Dynatrace são guardados encriptados (AES-256-GCM) e são limpos de quaisquer logs antes de persistidos.

## Permissões do Dynatrace (Tokens e Scopes)

Cada ambiente usa até **três credenciais diferentes**, e cada funcionalidade pede apenas o que necessita. Se uma secção der `403`, é porque a credencial correspondente carece de um scope desta tabela. A partir do formulário de Environment, cada credencial tem o seu botão **Test** para validar as permissões antes de guardar.

| Credencial | Utiliza-se para | Scopes / permissões requeridos |
|---|---|---|
| **API token clássico** (`Api-Token`) | Monaco: `download` e `deploy` | `ReadConfig`, `settings.read` (backup) · `WriteConfig`, `settings.write` (deploy) |
| **Platform token** (`dt0s16`) — Dashboards | Gestão de dashboards (Document API) | `document:documents:read`, `document:documents:write`, `document:documents:admin` |
| **Platform token** (`dt0s16`) — Lookups | Subir/listar/descarregar/eliminar lookups (Grail Resource Store) | `storage:files:read`, `storage:files:write`, `storage:files:delete`, `storage:buckets:read`, `storage:system:read` |
| **OAuth client de conta** (`dt0s02`) | Resolver SSO id → email (Account API) | `account-idm-read` |

> O Platform token é **um só** por ambiente: o mesmo token gere dashboards e lookups desde que tenha **ambos** os grupos de scopes.

### ⚠️ Os Platform tokens têm DOIS cadeados

Com um Platform token não chega marcar os scopes ao criá-lo. O acesso **efetivo** é a interseção:

```
permissão efetiva = (scopes do token)  ∩  (policy IAM do utilizador dono do token)
```

Ou seja, além dos scopes do token, **a policy IAM do grupo do utilizador que criou o token** deve conceder esses acessos. Para Grail files (lookups), essa policy deve incluir (ajuste o boundary de caminho conforme desejar):

```
ALLOW storage:files:read, storage:files:write, storage:files:delete
WHERE storage:file-path startsWith "/lookups/";
ALLOW storage:buckets:read;
ALLOW storage:system:read;
```

Erros frequentes quando dá `403` mesmo que o token "tenha" o scope:

- **A um Platform token não se podem adicionar scopes após ter sido criado.** Se alterar os acessos, gere um token novo e volte a colá-lo no ambiente.
- O token corre com as permissões do **seu dono**. Se a policy estiver num grupo ao qual o dono do token não pertence, não se aplica.
- Um **boundary** da policy (por caminho ou por ambiente) que não coincida denegará silenciosamente: verifique se inclui o ambiente e o caminho `/lookups/`.

O botão **Test** na secção de Lookups reporta leitura e escrita separadamente (`read` / `write`), para isolar exatamente qual o acesso em falta.

## Estrutura

Consulte a secção 7 de `specs/design.md` para ver o detalhe de pastas (`app/`, `lib/`, `prisma/`).
