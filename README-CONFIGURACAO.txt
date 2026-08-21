NS EMBALAGENS · GITHUB + VERCEL + SUPABASE

ARQUIVOS PARA O GITHUB
- index.html
- vercel.json
- api/_auth.js
- api/auth.js
- api/sync.js
- supabase.sql (pode ficar no repositório; não contém senha)
- .env.example (opcional; não contém senha)

1) SUPABASE
Abra SQL Editor e execute o conteúdo de supabase.sql uma única vez.

2) VERCEL > PROJECT > SETTINGS > ENVIRONMENT VARIABLES
Crie:
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SESSION_SECRET
NS_ACCESS1_PASSWORD
NS_ACCESS2_PASSWORD
NS_ACCESS3_PASSWORD

Não coloque a SUPABASE_SERVICE_ROLE_KEY dentro do index.html nem no GitHub.

3) DEPLOY
Conecte o repositório GitHub na Vercel e faça Redeploy depois de cadastrar as variáveis.

4) PRIMEIRO ACESSO
Entre primeiro com o Acesso 1. Se existir uma base antiga no navegador, o sistema migra essa base para o Supabase automaticamente. Depois disso o Supabase vira a fonte oficial.

5) SINCRONIZAÇÃO
As alterações passam a ser salvas em /api/sync e ficam compartilhadas entre computadores/celulares. A tela mostra o status Banco: Sincronizado / Salvando / Falha.

SEGURANÇA
As senhas não ficam mais gravadas no HTML. A validação ocorre em /api/auth usando variáveis privadas da Vercel. A Service Role Key também fica somente no servidor.
