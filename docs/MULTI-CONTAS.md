# Multi-contas: guia rápido

A partir da v3, uma única instância do servidor atende todas as contas de clientes que os tokens alcançam: Instagram, Threads e WhatsApp.

## 1. De onde vêm as contas

| Fonte | O que traz | Como ligar |
|---|---|---|
| Variáveis atuais (`INSTAGRAM_USER_ID`, `THREADS_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) | A conta padrão, chamada `default` | Nada muda em relação à v2 |
| Descoberta do Instagram | Toda Página que o token gerencia e o Instagram profissional ligado a ela, com o token da Página para o Direct | `INSTAGRAM_ACCESS_TOKEN` (token de usuário ou de usuário do sistema) |
| Descoberta do WhatsApp | Empresas → contas WhatsApp (próprias e de clientes) → números | `WHATSAPP_ACCESS_TOKEN` (ou `WHATSAPP_BUSINESS_ID`) |
| Arquivo de contas | Apelidos, conta padrão, perfis do Threads e a ligação Instagram + Threads + WhatsApp de cada cliente | `META_ACCOUNTS_FILE=/caminho/accounts.json` |

A descoberta fica em cache por 15 minutos (`META_ACCOUNTS_TTL`). Quando alguém pede uma conta desconhecida, a descoberta roda de novo, o que pega um cliente recém-adicionado.

## 2. Arquivo de contas

Veja o exemplo completo em [`accounts.example.json`](../accounts.example.json). Regras:

- O arquivo guarda **nomes de variáveis de ambiente**, nunca o token (`"token_env": "THREADS_TOKEN_GENIAL"`). Os tokens ficam no `.env` ou no painel de variáveis.
- `instagram` pode ser `"@usuario"`, o ID numérico ou um objeto com `username`, `user_id`, `page_id`, `token_env` e `page_token_env`. Se a conta já foi descoberta, basta o `@usuario`.
- `threads` exige `token_env`, porque cada perfil do Threads tem um token próprio. O `user_id` é opcional e, se faltar, o servidor busca com `/me`.
- `whatsapp` pode ser o número (`"+55 11 99999-0000"`), o `phone_number_id` ou um objeto com `phone_number_id`, `waba_id` e `token_env`.
- `default` escolhe a conta usada nas leituras sem `account`.

## 3. Como o agente escolhe a conta

- `meta_list_accounts` mostra todas as contas, com a chave, os apelidos, qual é a padrão e quais aceitam escrita.
- Toda ferramenta aceita `account`: a chave, um apelido, `@usuario`, um ID ou o telefone em qualquer formato.
- **Leitura** sem `account` usa a conta padrão.
- **Escrita** sem `account` (publicar, comentar, responder, mandar Direct ou WhatsApp, apagar) é **recusada** quando a plataforma tem mais de uma conta. A recusa lista as opções. Isso evita postar no perfil do cliente errado.
- `META_ALLOWED_ACCOUNTS=genial,rander` limita quais contas podem receber escrita. A leitura continua liberada em todas.
- Toda resposta traz `_account`, a conta que foi realmente usada.

## 4. WhatsApp: o que fica aqui e o que fica no MCP oficial

Fica aqui:
- envio de texto, template, mídia, mensagem interativa, localização e reação, e marcar como lida;
- upload de mídia;
- templates (listar, criar, apagar);
- perfil comercial e números;
- custo por categoria (`pricing`) e desempenho de templates.

Fica no MCP oficial da Meta (`https://mcp.facebook.com/whatsapp_business_tools`):
- adicionar, verificar e registrar números;
- configurar pagamento;
- verificar a empresa.

Mensagens recebidas não são lidas por nenhum dos dois, porque chegam só por webhook. Elas continuam no CRM.

Mensagem livre só chega a quem escreveu nas últimas 24 horas. Fora dessa janela, use um template.

## 5. Segurança

- Os tokens nunca aparecem nas respostas: são removidos dos links de paginação e das mensagens de erro.
- `meta_exchange_token` e `meta_refresh_token` devolvem o token mascarado. Para ver o token inteiro, defina `META_EXPOSE_TOKENS=true`.
- Se a publicação dá erro, o servidor confere o container antes de responder. Quando o container já está `PUBLISHED`, a resposta é sucesso, o que evita post duplicado na nova tentativa.
