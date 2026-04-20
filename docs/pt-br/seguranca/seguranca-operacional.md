# Segurança Operacional

## Propósito

Consolidar regras práticas de endurecimento para operar o bot com base em histórico real de risco.

## Público-alvo

Todos os mantenedores e operadores.

## Regras Não Negociáveis

- Nunca armazenar private key em `.env`.
- Nunca armazenar sessão Telegram brutas em `.env`.
- Nunca commitar segredos.
- Nunca adicionar remote install script sem revisão.
- Nunca assumir que código gerado é seguro.
- Preferir endurecimento incremental a reescrita.

## Controles Já Implementados

- `validateEnv` bloqueia segredos brutos conhecidos.
- `secretFileLoader` carrega chaves por path externo.
- `walletLoader` carrega keypair Solana por arquivo.
- `telegramSessionLoader` carrega sessão por path.
- `BOT_SECRETS_FILE` permite segredos fora do repo.
- Painel exige token para ações críticas quando remoto.
- systemd tem `NoNewPrivileges=true` e `PrivateTmp=true`.
- Supabase usa `SUPABASE_DB_URL_PATH`, não `SUPABASE_DB_URL`.
- Reconciliação nunca sobrescreve dados de close existentes.

## Lista de Verificação Antes da Operação ao Vivo

1. `PAPER_TRADING=true` validado por período operacional.
2. Segredos externos com permissão `600`.
3. Wallet/key correta para venue.
4. Painel remoto protegido por token.
5. Control bot restrito por IDs.
6. Primeiro trade ao vivo manual e pequeno.
7. Close manual validado.
8. Auto-trading habilitado apenas depois.

## Riscos

- Crítico: exfiltração de chave privada.
- Crítico: sessão Telegram vazada permitindo leitura/operação indevida.
- Alto: painel exposto sem token.
- Alto: bot de controle com autorização ampla.
- Alto: auto-trading ao vivo em venue recém-configurada.
- Médio: Supabase com permissão excessiva.

## Protocolo Seguro de Investigação

Ao investigar um incidente:

- Copie apenas logs sanitizados.
- Não cole o `.env` inteiro em ferramentas externas.
- Não cole a connection string Supabase.
- Não cole private keys, seeds, sessões ou tokens.
- Prefira mostrar nomes de variáveis e caminhos, não valores.

## Lista de Verificação Final

- [ ] Nenhum secret brutas no repo
- [ ] Caminhos absolutos para arquivos sensíveis
- [ ] Permissões revisadas
- [ ] Auto-trading desativado por padrão em novas venues
- [ ] Lacunas revisadas em [../operacoes/lacunas-e-riscos.md](../operacoes/lacunas-e-riscos.md)
