# Auction Admin Lab

Repositório local separado do painel Next.js. Código de avaliação com identidade própria e dados fictícios, não um painel de produção.

## Estado

- Criação e edição de produtos/leilões, caução variável, calendário, ações administrativas, avisos, revisão de saques e auditoria.
- Next.js com exportação estática; Worker preparado para demonstrações isoladas por navegador em Durable Objects SQLite, com expiração em 24 horas.
- Adaptador opcional para a API local de `../emirates-auction-frontend`, usando cookie administrativo separado.
- 13 testes de domínio passaram; build passou; Worker local iniciou sessão e retornou oito lotes e três perfis fictícios.
- Validação integral da UI e do adaptador local pendente. CSS de reset adicionado após o último build.
- Nenhum deploy ou push realizado. Servidor temporário encerrado. O usuário exige produção; esta demonstração não atende esse requisito.

## Execução local

```sh
npm ci
npm run build
npm run preview
```

Acesse `http://127.0.0.1:3011`. O modo padrão usa um catálogo isolado de teste. Para usar a API local, crie `.dev.vars` com `LOCAL_API_ORIGIN="http://127.0.0.1:3010"` e inicie o servidor do outro projeto. O proxy recusa esse modo fora de localhost.

Não existem recebimento de pagamentos, carteiras, credenciais de produção, dados de clientes ou conexão com o serviço oficial. O acesso à demonstração não é autenticação administrativa de produção. `wrangler.jsonc` identifica a conta Jessica, mas não foi publicado.
