# Recuperação de dados — NS Embalagens

## Falha encontrada

O HTML antigo possuía `clearOldLocal()` removendo **as duas cópias locais principais** (`STORE` e `LEGACY_STORE`) depois que o Supabase respondia. Isso deixava o navegador sem uma cópia de segurança confiável. Como o backend antigo mantinha apenas uma linha `main` e sobrescrevia o `payload` inteiro, uma gravação incompleta/antiga podia substituir a única cópia do banco.

## O que foi corrigido no novo `index.html`

- não inicializa nem grava `EMPTY` automaticamente;
- bloqueia qualquer POST quando o banco parece vazio/reduzido e existe dúvida de recuperação;
- varre **todas** as chaves JSON de `localStorage` e `sessionStorage`;
- reconhece também backups próprios do Financeiro (`ns_embalagens_financeiro360_local_v2`) e Compras (`nsComprasMateriaPrimaUltraV1`);
- mantém snapshots novos em IndexedDB;
- adiciona o botão **Recuperar dados**;
- se uma cópia local tiver mais registros que o banco, ela é carregada somente na tela e o banco NÃO é sobrescrito automaticamente;
- a restauração só ocorre após confirmação explícita e termina com POST + GET de conferência;
- durante o modo de recuperação, `queueSave`, `flush`, refresh automático e `beforeunload` ficam impedidos de sobrescrever o banco.

## O que foi corrigido no novo backend `api_sync_seguro.js`

- mantém compare-and-swap por `updated_at`;
- antes de cada sobrescrita, arquiva a versão atual da linha `main` em uma linha `hist_*` na própria tabela;
- guarda até 20 versões históricas;
- permite listar histórico com `GET /api/sync?history=1`;
- permite ler um snapshot com `GET /api/sync?historyId=...`;
- permite restaurar histórico com `POST { action: "restoreHistory", historyId, expectedUpdatedAt, clientId, saveId }`;
- nenhuma restauração ignora conflito de versão.

## Ordem segura para publicar

1. Publicar primeiro `api_sync_seguro.js` no lugar do `/api/sync`.
2. Publicar depois o novo `index.html`.
3. Abrir o sistema no **mesmo domínio e no mesmo navegador/computador** onde os dados eram usados.
4. Entrar com o Acesso 1.
5. Clicar em **Recuperar dados**.
6. O sistema mostrará quantos registros existem no banco e nas cópias locais encontradas.
7. Se uma cópia correta aparecer, carregá-la na tela, conferir os dados e somente então confirmar a restauração no banco.

## Se nenhuma cópia local aparecer

O backend antigo guardava só uma linha `main` e não mantinha histórico. Se essa linha já foi sobrescrita e as chaves locais foram apagadas, o HTML não consegue recriar registros que não existem mais em nenhuma fonte.

Nesse caso, a recuperação deve vir de backup do Supabase feito antes do incidente. Prefira **restaurar para um novo projeto** para não arriscar o banco atual; depois copie apenas a linha `main` da tabela `ns_embalagens_state` para o projeto atual.

